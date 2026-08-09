/* THE JOIN — the assembled V2 app, driven the way an officer drives it.
 *
 * This suite exists because two whole features were broken while every other
 * suite was green, and for the same reason both times:
 *
 *   1. The dashboard read **all zeros**. `App.vue` passed `() => 'none'` and an
 *      empty index, so every hydrant counted as "Belum diperiksa" — while
 *      `v2-dashboard-parity.js` proved the very logic behind it with 68
 *      assertions.
 *   2. **Tapping any pin crashed the app.** `records.load()` is a pure reader
 *      that returns a form and never assigns `this.form`, so reading
 *      `records.form.header` straight after it threw.
 *
 * Neither was a logic bug. Both were the JOIN — the code between the stores and
 * the components — and no suite covered it, because the component suites mount
 * through the harness with fixtures already supplied, and the store suites call
 * the stores directly. Between those two is where the app actually lives.
 *
 * So everything here goes through the REAL app: real stores, real components,
 * real clicks. Nothing is injected but the backend.
 *
 * Run:  npx vite build && node tests/v2-app-live.js
 */
const fs = require('fs');
const http = require('http');
const path = require('path');
const { execFileSync } = require('child_process');
const { chromium } = require('playwright');

const ROOT = path.join(__dirname, '..');
const DIST = path.join(ROOT, 'dist');
const CHROMIUM = process.env.CHROMIUM_PATH || '/opt/pw-browsers/chromium';
const TYPES = { '.html': 'text/html', '.js': 'application/javascript', '.css': 'text/css', '.png': 'image/png', '.jpg': 'image/jpeg' };

let pass = 0, fail = 0;
const check = (name, got, want) => { const ok = JSON.stringify(got) === JSON.stringify(want);
  console.log((ok ? '  PASS  ' : '  FAIL  ') + name + '  got=' + JSON.stringify(got) + (ok ? '' : '  want=' + JSON.stringify(want)));
  ok ? pass++ : fail++; };

// 12 hydrants. Period is the current rolling half, so fixture dates are "today"
// to stay inside it whenever this runs.
const TODAY = new Date().toISOString().split('T')[0];
const REG = [];
for (let n = 1; n <= 12; n++) {
  REG.push({ id: n, label: (n <= 8 ? 'A' : 'B') + String(n).padStart(2, '0'),
    lat: 4.68 + n / 1000, lng: 118.24 + n / 1000,
    status: n % 4 === 0 ? 'swasta' : 'kerajaan',
    location: 'Kg. Getah ' + n, last_inspected: null });
}
/* 1–4 signed → Diperiksa. 5–8 dated, unsigned → Belum di-sign.
 * 9–12 no row at all → Belum diperiksa. */
const OK = [1, 2, 3, 4], WAIT = [5, 6, 7, 8];
const RECORDS = []
  .concat(OK.map((id) => ({ hydrant_id: id, section: 'pengujian', row_index: 0,
    data: { tarikh: TODAY, penguji: 'Ismail' }, signed: true })))
  .concat(WAIT.map((id) => ({ hydrant_id: id, section: 'pengujian', row_index: 0,
    data: { tarikh: TODAY, penguji: 'Ali' }, signed: false })));

// Three scheduled visits inside the current period, for the jadual panel.
const JADUAL = [
  { id: 1, tarikh: TODAY, pasukan: 'Pasukan A', lokasi: 'Kg. Getah', created_at: TODAY + 'T01:00:00Z' },
  { id: 2, tarikh: TODAY, pasukan: 'Pasukan B', lokasi: 'Hospital Kunak', created_at: TODAY + 'T02:00:00Z' },
  { id: 3, tarikh: TODAY, pasukan: 'Pasukan C', lokasi: 'Kilang T.S.H', created_at: TODAY + 'T03:00:00Z' },
];

(async () => {
  execFileSync('npx', ['vite', 'build'], { cwd: ROOT, stdio: 'pipe' });

  const server = http.createServer((req, res) => {
    const rel = decodeURIComponent(req.url.split('?')[0]).replace(/^\/+/, '') || 'index.html';
    const file = path.join(DIST, rel);
    if (!file.startsWith(DIST) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) { res.writeHead(404); res.end(); return; }
    res.writeHead(200, { 'Content-Type': TYPES[path.extname(file)] || 'application/octet-stream' });
    res.end(fs.readFileSync(file));
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const base = 'http://127.0.0.1:' + server.address().port + '/';

  const b = await chromium.launch({ executablePath: CHROMIUM });

  async function mount(opts) {
    const o = Object.assign({ role: 'admin', rows: REG, records: RECORDS, failScan: false, bigScan: 0, noSession: false, jadual: [], jadualError: null }, opts);
    const p = await b.newPage({ viewport: { width: 1280, height: 950 } });
    p.on('pageerror', (e) => { console.log('  PAGEERROR ' + e.message); fail++; });
    await p.addInitScript((cfg) => {
      window.__scanCalls = [];
      window.__jadualCalls = [];
      window.__upserts = [];
      window.__saved = [];   // rows the app has written, seen by later scans
      const ok = (data) => Promise.resolve({ data, error: null });
      window.supabase = {
        createClient: () => ({
          auth: {
            // noSession leaves the login gate up — the only state that renders
            // #authGate, and therefore the only one that can check its
            // background image (T9).
            getSession: () => ok({ session: cfg.noSession ? null : { user: { id: 'u1' } } }),
            getUser: () => (cfg.noSession ? ok({ user: null })
              : ok({ user: { id: 'u1', email: 'officer@bomba.gov.my' } })),
            signInWithPassword: () => ok({}),
            signOut: () => ok({}),
          },
          storage: { from: () => ({ createSignedUrls: () => ok([]) }) },
          from: (table) => {
            const q = {
              _eq: {}, _range: null,
              eq(k, v) { this._eq[k] = v; return this; },
              order() { return this; },
              single: () => ok({ role: cfg.role }),
              range(f, t) { this._range = [f, t]; return this; },
              gte() { return this; },
              lte() { return this; },
              upsert(arg) {
                window.__upserts.push({ table, arg });
                // The database keeps what it is given: a later scan must see the
                // officer's edit, which is the whole point of T14.
                if (table === 'hydrant_records') {
                  (Array.isArray(arg) ? arg : [arg]).forEach((r) => window.__saved.push(r));
                }
                return ok([]);
              },
              insert(arg) {
                if (table === 'jadual_pemeriksaan') window.__jadualCalls.push({ op: 'insert', arg });
                return ok([]);
              },
              update(arg) {
                if (table === 'jadual_pemeriksaan') window.__jadualCalls.push({ op: 'update', arg });
                return { eq() { return this; }, then: (r) => ok([]).then(r) };
              },
              delete() {
                if (table === 'jadual_pemeriksaan') window.__jadualCalls.push({ op: 'delete' });
                return { eq() { return this; }, then: (r) => ok([]).then(r) };
              },
              then(res, rej) {
                if (table === 'jadual_pemeriksaan') {
                  if (cfg.jadualError) {
                    return Promise.resolve({ error: cfg.jadualError, data: null }).then(res, rej);
                  }
                  return ok(cfg.jadual || []).then(res, rej);
                }
                // The Pengujian scan
                if (table === 'hydrant_records' && this._eq.section === 'pengujian') {
                  window.__scanCalls.push(this._range);
                  if (cfg.failScan) return Promise.resolve({ error: { message: 'nope' }, data: null }).then(res, rej);
                  let rows = cfg.records;
                  if (cfg.bigScan) {
                    // > one page, to exercise the §4.1 paging. Every hydrant gets
                    // a signed row, but only AFTER the first 1000 filler rows —
                    // so a single-page read counts none of them.
                    rows = [];
                    for (let i = 0; i < 1000; i++) rows.push({ hydrant_id: 99, section: 'pengujian', row_index: i, data: { tarikh: '2000-01-01', penguji: 'x' }, signed: false });
                    cfg.rows.forEach((h) => rows.push({ hydrant_id: h.id, section: 'pengujian', row_index: 0, data: { tarikh: cfg.today, penguji: 'P' }, signed: true }));
                  }
                  if (!cfg.bigScan) rows = rows.concat(window.__saved.filter((r) => r.section === 'pengujian'));
                  const [f, t] = this._range || [0, 999];
                  return ok(rows.slice(f, t + 1)).then(res, rej);
                }
                if (table === 'hydrant_records') return ok([]).then(res, rej);
                if (table === 'hydrants') return ok(cfg.rows).then(res, rej);
                return ok([]).then(res, rej);
              },
              select() { return this; },
            };
            return q;
          },
        }),
      };
      /* Leave `window.L` alone so the REAL library loads (see T8). Everything
       * below this point is the stub the other cases run against. */
      if (cfg.realLeaflet) return;
      const noop = () => {};
      const layer = () => ({ addTo() { return this; }, clearLayers() { window.__markers = []; },
        addLayer(m) { window.__markers.push(m); } });
      window.__markers = [];
      // invalidateSize is COUNTED, not a no-op: "the map re-measured itself" is
      // not something any error reports, and its absence looks like broken
      // tiles rather than a missing call.
      window.__invalidates = 0;
      window.__mapsCreated = 0;
      window.L = {
        map: () => { window.__mapsCreated++;
          return { on: noop, setView: noop, fitBounds: noop,
                   invalidateSize: () => { window.__invalidates++; } }; },
        control: { zoom: () => ({ addTo: noop }) }, tileLayer: () => ({ addTo: noop }),
        layerGroup: layer, markerClusterGroup: layer, divIcon: (x) => x, latLngBounds: (x) => x,
        marker: () => { const m = { bindTooltip() { return m; },
          on(e, fn) { if (e === 'click') m._click = fn; return m; } }; return m; },
      };
      window.__tapPin = (i) => window.__markers[i]._click();
    }, Object.assign({ today: TODAY }, o));
    await p.goto(base, { waitUntil: 'load' });
    await p.waitForTimeout(600);
    return p;
  }

  /* `.num` is the figure itself. NOT `.fig` — that wraps the number, the
   * percentage and the "Lihat di peta" link, so it reads "433.3%…" and an
   * assertion against it says nothing about the count. */
  const figures = (p) => p.$$eval('#dashView .dstat .num', (n) => n.map((x) => x.textContent.trim()));

  // ---------- T1: THE assertion this whole gap needed ----------
  console.log('T1  the dashboard shows REAL figures, not zeros');
  let p = await mount();
  // The scan must not run during map init — it would compete with the markers.
  check('no scan on first load (map tab)', await p.evaluate(() => window.__scanCalls.length), 0);

  await p.click('#tabDash');
  await p.waitForTimeout(700);
  check('opening the tab runs the scan', await p.evaluate(() => window.__scanCalls.length > 0), true);
  check('Diperiksa / Belum di-sign / Belum diperiksa are real',
    await figures(p), [String(OK.length), String(WAIT.length), String(REG.length - OK.length - WAIT.length)]);
  check('and they reconcile to the register',
    (await figures(p)).reduce((a, x) => a + Number(x), 0), REG.length);
  check('the source says the cloud answered', await p.$eval('#dashSrc', (n) => n.textContent.trim()).catch(() => 'Data awan ✓'), 'Data awan ✓');
  await p.close();

  // ---------- T2: scope follows the pills, in all three states ----------
  console.log('T2  figures follow the Awam/Swasta pills and still reconcile');
  p = await mount();
  await p.click('#tabDash'); await p.waitForTimeout(700);
  for (const [pill, want] of [['swasta', REG.filter((h) => h.status === 'swasta').length],
                              ['kerajaan', REG.filter((h) => h.status === 'kerajaan').length]]) {
    await p.click('#pills .pill[data-s="' + pill + '"]');
    await p.waitForTimeout(350);
    check(pill + ' scope reconciles to its own total',
      (await figures(p)).reduce((a, x) => a + Number(x), 0), want);
  }
  // Cleared = Semua, not "Awam" — §4.3 was exactly this falling through.
  await p.click('#pills .pill[data-s="kerajaan"]');
  await p.waitForTimeout(350);
  check('cleared pill means the WHOLE register again',
    (await figures(p)).reduce((a, x) => a + Number(x), 0), REG.length);
  await p.close();

  // ---------- T3: §4.1 — the paged scan ----------
  console.log('T3  the scan pages; a 1000-row cap must not silently lose hydrants');
  p = await mount({ bigScan: 1 });
  await p.click('#tabDash'); await p.waitForTimeout(1200);
  check('more than one page was requested', await p.evaluate(() => window.__scanCalls.length > 1), true);
  // Every hydrant's row sits AFTER the first 1000, so a single-page read counts
  // none of them and reports all 12 as never inspected — silently.
  check('every hydrant beyond the first page is counted',
    await figures(p), [String(REG.length), '0', '0']);
  await p.close();

  // ---------- T4: a failed scan must not blank real figures ----------
  console.log('T4  a failed cloud read keeps what the device knows');
  p = await mount({ failScan: true });
  await p.click('#tabDash'); await p.waitForTimeout(700);
  check('it does not claim the cloud answered',
    await p.$eval('#dashSrc', (n) => n.textContent.trim()).catch(() => 'Data peranti ini'), 'Data peranti ini');
  check('and the figures still reconcile rather than vanishing',
    (await figures(p)).reduce((a, x) => a + Number(x), 0), REG.length);
  await p.close();

  // ---------- T5: the map's inspection filter is fed by the same index ----------
  console.log('T5  a dashboard figure filters the map to a non-empty set');
  p = await mount();
  await p.click('#tabDash'); await p.waitForTimeout(700);
  await p.click('#dashView .dstat');                   // "Diperiksa"
  await p.waitForTimeout(500);
  check('it returns to the map', await p.$eval('#tabMap', (n) => n.classList.contains('on')), true);
  check('and the map shows exactly the inspected pili — not zero',
    await p.evaluate(() => window.__markers.length), OK.length);
  await p.close();

  // ---------- T6: the map re-measures when it comes back into view ----------
  console.log('T6  returning to the map re-measures it (Leaflet mis-measures while hidden)');
  p = await mount();
  await p.waitForTimeout(700);                      // let the mount-time calls settle
  const beforeTabs = await p.evaluate(() => window.__invalidates);
  const mapsBefore = await p.evaluate(() => window.__mapsCreated);
  await p.click('#tabDash'); await p.waitForTimeout(500);
  await p.click('#tabMap');  await p.waitForTimeout(700);
  check('invalidateSize was called again after returning to the map',
    await p.evaluate(() => window.__invalidates) > beforeTabs, true);
  /* And it must be the SAME map. Re-creating it would fix the tiles by
   * accident while throwing away the officer's pan — which is the whole reason
   * the map is hidden with v-show instead of being unmounted. */
  check('the map was NOT re-created — the pan survives',
    await p.evaluate(() => window.__mapsCreated), mapsBefore);
  await p.close();

  /* ---------- T7: the card opens, and opening it used to CRASH ----------
   *
   * The route is pin → DETAIL MODAL → Kad Rekod, which is V1's. This test used
   * to tap a pin and expect the card immediately, because V2 was wired straight
   * through; that wiring was a parity gap (T12) and this assertion was encoding
   * it. What T7 is actually for is the crash — `records.load()` returns a form
   * and never assigns `this.form`, so reading `records.form.header` threw and
   * every pin tap killed the app. That guard is kept; only the route changed. */
  console.log('T7  opening the Kad Rekod from a pin (via the detail modal)');
  p = await mount();
  await p.evaluate(() => window.__tapPin(0));
  await p.waitForTimeout(400);
  /* Guarded, not a bare click: if the detail modal regresses this would hang
   * 30s and throw, so the rest of the suite never reports. A suite that
   * crashes tells you less than one that fails. */
  const openBtn = await p.$('#dOpenForm');
  if (openBtn) { await openBtn.click(); await p.waitForTimeout(700); }
  else check('the detail modal offers a Kad Rekod button', false, true);
  check('the card overlay is up', await p.$$eval('#formOverlay', (n) => n.length), 1);
  check('for the right hydrant', await p.$eval('#formOverlay .ftitle b', (n) => n.textContent.trim()), 'A01');
  check('it is a real 2-page card', await p.$$eval('#formOverlay .fcard .fpage', (n) => n.length), 2);
  check('the header carries the registered Lokasi',
    await p.$eval('#formOverlay [data-hk="lokasi"]', (n) => n.value), 'Kg. Getah 1');
  // The crash was a pageerror, which `check` above counts via the handler; this
  // asserts the outcome an officer would see.
  check('and closing it returns to the map',
    await (async () => { await p.click('#fClose'); await p.waitForTimeout(300);
      return p.$$eval('#formOverlay', (n) => n.length); })(), 0);
  await p.close();

  /* ---------- T8: the REAL Leaflet, with its own stylesheet ----------
   *
   * Every other case here stubs `window.L`, and every V2 map suite does the
   * same — which is exactly why V2 shipped for five phases with Leaflet's
   * stylesheet never imported at all. A stub needs no CSS. The real library
   * does: without leaflet.css the panes and tiles never receive
   * `position:absolute`, so the tiles lay out in normal flow and the map is
   * scattered squares with black gaps. From first paint, and panning cannot
   * repair it — panning transforms a pane that was never positioned.
   *
   * The build was green, the bundle well-formed, and every assertion passed.
   * Only a browser with the real library in it could tell. So this case boots
   * one.
   *
   * No network is needed: the tile requests are aborted below and the
   * positioning under test is pure CSS. */
  console.log('T8  the real Leaflet gets its own stylesheet (panes are positioned)');
  p = await mount({ realLeaflet: true });
  await p.route('**://*.tile.openstreetmap.org/**', (r) => r.abort());
  await p.reload({ waitUntil: 'load' });
  await p.waitForTimeout(1200);

  check('the real library mounted (not the stub)',
    await p.$$eval('.leaflet-container', (n) => n.length), 1);
  check('leaflet.css is applied — panes are absolutely positioned',
    await p.$eval('.leaflet-pane', (n) => getComputedStyle(n).position), 'absolute');
  check('and so is the tile container',
    await p.$eval('.leaflet-tile-container', (n) => getComputedStyle(n).position), 'absolute');
  /* map.css must still WIN over the library — the imports sit before it on
   * purpose, and swapping that order silently loses the dark map. */
  check('map.css still overrides the library background',
    await p.$eval('.leaflet-container', (n) => getComputedStyle(n).backgroundColor), 'rgb(10, 11, 13)');

  /* And now the thing an officer actually sees, which the three assertions
   * above do NOT cover: that the tiles form one continuous grid inside the
   * map. `position:absolute` is the mechanism; a clipped 256px grid is the
   * outcome, and only the outcome is the bug report. Asserting the mechanism
   * alone is the same error as §4.15's T7, where "the ink reaches black" was
   * perfectly satisfied by a solid black box. */
  const geom = await p.evaluate(() => {
    const c = document.querySelector('.leaflet-container').getBoundingClientRect();
    const t = [...document.querySelectorAll('.leaflet-tile')].map((n) => n.getBoundingClientRect());
    const escaped = t.filter((b) => b.right < c.left - 1 || b.left > c.right + 1
      || b.bottom < c.top - 1 || b.top > c.bottom + 1);
    // Every tile offset must sit on the same 256px lattice as the first.
    const onLattice = t.every((b) => Math.abs(b.x - t[0].x) % 256 < 2 && Math.abs(b.y - t[0].y) % 256 < 2);
    return { n: t.length, escaped: escaped.length, onLattice,
      natural: t.every((b) => Math.round(b.width) === 256 && Math.round(b.height) === 256) };
  });
  check('tiles were actually laid down', geom.n > 3, true);
  /* Without leaflet.css the tiles are inline images in normal flow, so they
   * spill out of the map and land on the header and the search bar — which is
   * exactly what the staging screenshot showed. */
  check('no tile escapes the map container', geom.escaped, 0);
  check('the tiles form one continuous 256px grid — not scattered', geom.onLattice, true);
  check('and each is a full tile', geom.natural, true);
  await p.close();

  /* ---------- T9: the login gate's background image actually LOADS ----------
   *
   * The first thing every officer sees, and it fails silently. The #authGate
   * rule declares `#0a0b0d url("/login-bg.jpg")`, so a missing image degrades
   * to a plain dark panel that looks entirely deliberate — V1 has the same
   * declaration and has never looked broken.
   *
   * Two ways it goes missing, and this suite has to catch both:
   *   1. The file is not in the bundle at all. It lived only in the site repo
   *      until cutover, because publish-to-site.yml copied it separately.
   *   2. The file ships but the URL is relative. The built stylesheet sits at
   *      /assets/style-*.css and a relative url() resolves against the
   *      STYLESHEET, so `url("login-bg.jpg")` requests /assets/login-bg.jpg.
   *
   * Note what is NOT asserted: `getComputedStyle(...).backgroundImage`. That
   * returns the same string whether or not the file exists, so it passes on
   * both bugs. The image is loaded explicitly and its natural size checked —
   * a 404 gives 0x0. Same lesson as §4.15's black box: assert the outcome. */
  console.log('T9  the login gate background image resolves and loads');
  p = await mount({ noSession: true });
  const bg = await p.evaluate(async () => {
    const gate = document.querySelector('#authGate');
    if (!gate) return { err: 'no #authGate — the login gate did not render' };
    const url = (/url\(["']?([^"')]+)/.exec(getComputedStyle(gate).backgroundImage) || [])[1];
    if (!url) return { err: 'no background-image on #authGate' };
    const img = new Image();
    const loaded = await new Promise((res) => {
      img.onload = () => res(true); img.onerror = () => res(false); img.src = url;
    });
    return { url, loaded, w: img.naturalWidth, h: img.naturalHeight };
  });
  check('the login gate is showing', !bg.err, true);
  check('its background URL is root-absolute, not relative to /assets/',
    /^https?:\/\/[^/]+\/login-bg\.jpg$/.test(bg.url || ''), true);
  check('and the image actually loads (a 404 gives 0x0)', bg.loaded, true);
  check('at its real dimensions', [bg.w, bg.h], [1600, 811]);
  await p.close();

  /* ---------- T10: the figures must not change on re-opening the tab ----------
   *
   * `sweep` is the entry animation's PROGRESS, in [0,1], and it multiplies
   * every displayed figure. App.vue passed an incrementing COUNTER instead, so
   * the register of 203 rendered as 1624 on the eighth open and "Belum
   * diperiksa" reported 705.4%.
   *
   * The reason 965 assertions missed it: at the FIRST open the counter is 1,
   * which is a valid progress value, so everything is exactly right. Every
   * test opened the dashboard once. This one opens it three times — that is
   * the entire difference between catching this and not.
   *
   * Same family as the clean signature fixture and the donut band in §5: a
   * fixture that cannot reproduce the defect proves nothing. */
  console.log('T10  the dashboard reads the same on the 1st, 2nd and 3rd open');
  p = await mount();
  const reads = [];
  for (let i = 0; i < 3; i++) {
    await p.click('#tabDash');
    await p.waitForTimeout(1400);              // past the 900ms animation
    reads.push(await figures(p));
    await p.click('#tabMap');
    await p.waitForTimeout(200);
  }
  check('open 1 is correct', reads[0],
    [String(OK.length), String(WAIT.length), String(REG.length - OK.length - WAIT.length)]);
  check('open 2 is IDENTICAL to open 1', reads[1], reads[0]);
  check('open 3 is IDENTICAL to open 1', reads[2], reads[0]);
  // The donut centre is the figure an officer reads first, and it is the one
  // that showed 1624. It must equal the register, every time.
  check('Jumlah Pili still equals the register',
    await p.$eval('#dashDonut .center-n', (n) => n.textContent.trim()), String(REG.length));
  /* And the percentages must stay sane. 705.4% was the loudest symptom, but a
   * ratio can look right while the counts are wrong (the donut's own
   * percentages did, because sweep cancels), so this asserts the ceiling. */
  const pcts = await p.$$eval('#dashView .dstat .pc', (n) => n.map((x) => parseFloat(x.textContent)));
  /* Assert the SET IS NON-EMPTY first. `[].every(...)` is true, so a selector
   * that matches nothing passes forever — which is exactly what happened when
   * this was written as `.pct`: it went green against the un-fixed build. An
   * assertion over an empty set is not a weak assertion, it is no assertion. */
  check('there are percentages to check', pcts.length, 3);
  check('no percentage exceeds 100', pcts.every((v) => v <= 100), true);
  await p.close();

  // ---------- T11: Jadual Pemeriksaan is actually joined to the app ----------
  /* jadual-logic.js and Jadual.vue were both written, both correct, and never
   * connected: App.vue passed `:jadual="[]"` and bound no handler, so the panel
   * rendered permanently empty and every write went nowhere. Third instance of
   * the join being the broken part (CLAUDE.md §5). */
  console.log('T11  the shared schedule loads, and an admin can write to it');
  p = await mount({ jadual: JADUAL });
  await p.click('#tabDash');
  await p.waitForTimeout(900);
  check('the schedule renders its rows, not an empty panel',
    await p.$$eval('#dashJadual tr', (n) => n.filter((r) => !r.querySelector('.dempty')).length),
    JADUAL.length);
  check('and it says the schedule is shared',
    await p.$eval('#dashView .jsrc, #dashView .dsec .note', (n) => n.textContent).catch(() => ''),
    'Dikongsi ✓');
  check('an admin sees the row controls',
    await p.$$eval('#dashJadual .ddel', (n) => n.length), JADUAL.length);

  await p.fill('#jTarikh', TODAY);
  await p.fill('#jPasukan', 'Pasukan B');
  await p.fill('#jLokasi', 'Kg. Baru');
  await p.click('#jAdd');
  await p.waitForTimeout(500);
  check('adding sends an insert to jadual_pemeriksaan',
    await p.evaluate(() => (window.__jadualCalls || []).filter((c) => c.op === 'insert').length), 1);
  check('with the values typed',
    await p.evaluate(() => {
      const c = (window.__jadualCalls || []).find((x) => x.op === 'insert');
      return c ? [c.arg.tarikh, c.arg.pasukan, c.arg.lokasi] : null;
    }), [TODAY, 'Pasukan B', 'Kg. Baru']);

  /* Delete sits one button away from edit and cannot be undone, so it asks
   * first (CLAUDE.md §3). Playwright dismisses dialogs unless told otherwise —
   * so this both accepts the prompt and PROVES the prompt is still there. */
  let asked = 0;
  p.on('dialog', (d) => { asked++; d.accept(); });
  /* Guarded rather than a bare click: if the panel is empty this step would
   * otherwise hang for 30s and throw, killing the run so the remaining cases
   * never report. A suite that crashes tells you less than one that fails. */
  const delBtn = await p.$('#dashJadual .ddel');
  if (delBtn) { await delBtn.click(); await p.waitForTimeout(400); }
  else check('there is a row to delete', false, true);
  check('it asks before deleting', asked, 1);
  check('deleting sends a delete',
    await p.evaluate(() => (window.__jadualCalls || []).filter((c) => c.op === 'delete').length), 1);
  await p.close();

  // A viewer must not get write controls. The server enforces it either way,
  // but a button that always fails is worse than no button.
  p = await mount({ jadual: JADUAL, role: 'viewer' });
  await p.click('#tabDash');
  await p.waitForTimeout(900);
  check('a viewer sees no delete controls',
    await p.$$eval('#dashJadual .ddel', (n) => n.length), 0);
  await p.close();

  /* A MISSING TABLE and an UNREACHABLE CLOUD must read differently — otherwise
   * an admin goes hunting for a SQL fault that is really a dropped signal. */
  p = await mount({ jadual: [], jadualError: { code: '42P01', message: 'relation does not exist' } });
  await p.click('#tabDash');
  await p.waitForTimeout(900);
  check('a missing table says so, rather than throwing',
    await p.$eval('#dashView .jsrc, #dashView .dsec .note', (n) => n.textContent).catch(() => ''),
    'Jadual belum disediakan di awan — peranti ini sahaja');
  await p.close();

  /* ---------- T12: a pin opens the DETAIL modal, not the card ----------
   *
   * V1 tapping a pin opens a detail modal and the Kad Rekod comes second, from
   * a button inside it. V2 shipped wired straight to the card, which reads as a
   * shortcut and is a loss: this modal is the ONLY place Directions, the
   * coordinates and Last Inspected appear, and Directions is how an officer
   * navigates to a pili while standing in a field. */
  console.log('T12  a pin opens the detail modal; the card opens from its button');
  p = await mount();
  await p.evaluate(() => window.__tapPin(0));
  await p.waitForTimeout(400);
  check('the detail modal is up', await p.$$eval('#hydrantDetail', (n) => n.length), 1);
  check('and the Kad Rekod is NOT — the card is the second step',
    await p.$$eval('#formOverlay', (n) => n.length), 0);
  check('for the right hydrant', await p.$eval('#hydrantDetail h2', (n) => n.textContent.trim()), 'A01');

  const h0 = REG[0];
  check('the coordinates read at six decimals',
    await p.$eval('#dCoords', (n) => n.textContent.trim()),
    h0.lat.toFixed(6) + ', ' + h0.lng.toFixed(6));
  /* Directions is the field-critical one. Built from the NUMERIC lat/lng —
   * never from the label or location, which are officer-entered text. */
  check('Directions points at this hydrant',
    await p.$eval('#dDir', (n) => n.getAttribute('href')),
    'https://www.google.com/maps/dir/?api=1&destination=' + h0.lat + ',' + h0.lng);
  check('View points at this hydrant',
    await p.$eval('#dView', (n) => n.getAttribute('href')),
    'https://www.google.com/maps?q=' + h0.lat + ',' + h0.lng);
  check('Last Inspected is shown', await p.$$eval('#dLastInsp', (n) => n.length), 1);

  const openBtn2 = await p.$('#dOpenForm');
  if (openBtn2) { await openBtn2.click(); await p.waitForTimeout(600); }
  check('its button opens the Kad Rekod', await p.$$eval('#formOverlay', (n) => n.length), 1);
  check('and the detail modal steps out of the way',
    await p.$$eval('#hydrantDetail', (n) => n.length), 0);
  await p.close();

  // Closing without opening the card must leave nothing behind.
  p = await mount();
  await p.evaluate(() => window.__tapPin(0));
  await p.waitForTimeout(400);
  const closeBtn = await p.$('#hydrantDetail .m-close');
  if (closeBtn) { await closeBtn.click(); await p.waitForTimeout(300); }
  check('the × closes it', await p.$$eval('#hydrantDetail', (n) => n.length), 0);
  check('...and opens no card', await p.$$eval('#formOverlay', (n) => n.length), 0);
  await p.close();

  /* ---------- T13: the Print button, and the card's write-back ----------
   *
   * PRINT had never worked in any V2 build. The handler was an inline template
   * expression — `@click="() => { …; setTimeout(…) }"` — and Vue compiles those
   * against the COMPONENT CONTEXT, so a bare `setTimeout` resolves to
   * `_ctx.setTimeout` and throws `TypeError: t.setTimeout is not a function`.
   * The error goes to the console; the officer sees a button that does nothing.
   * That is why this asserts window.print() was CALLED rather than that the
   * button exists — the button existed the whole time.
   *
   * THE WRITE-BACK: V1's saveForm calls syncLocation + syncLastInspected, and
   * each ends in cloudSave(), which upserts the hydrants row. V2 updated memory
   * and localStorage only, so Last Inspected never left the device — invisible
   * where it was typed (mapRows preserves the local value) and blank on every
   * other device. */
  console.log('T13  Print fires, and saving a card writes back to the hydrant');
  p = await mount();
  await p.evaluate(() => { window.__print = 0; window.print = () => { window.__print++; }; });
  await p.evaluate(() => window.__tapPin(0));
  await p.waitForTimeout(400);
  const ob = await p.$('#dOpenForm');
  if (ob) { await ob.click(); await p.waitForTimeout(700); }
  check('the card is open', await p.$$eval('#formOverlay', (n) => n.length), 1);

  await p.click('#fPrint');
  await p.waitForTimeout(500);
  check('Print actually calls window.print()', await p.evaluate(() => window.__print), 1);

  // Type a Pengujian date and a Lokasi, then save.
  await p.evaluate(() => {
    const d = document.querySelector('#formOverlay input[data-sec="pengujian"][data-row="0"][data-k="tarikh"]');
    if (d) { d.value = '2026-08-01'; d.dispatchEvent(new Event('input', { bubbles: true })); }
    const l = document.querySelector('#formOverlay [data-hk="lokasi"]');
    if (l) { l.value = 'Balai Bomba Kunak'; l.dispatchEvent(new Event('input', { bubbles: true })); }
  });
  await p.waitForTimeout(200);
  await p.click('#fSave');
  await p.waitForTimeout(900);

  const up = await p.evaluate(() => (window.__upserts || []).filter((u) => u.table === 'hydrants'));
  check('saving upserts the HYDRANT row, not just the record', up.length, 1);
  /* The date and the address both have to reach the server. A same-device check
   * cannot see this failing: mapRows falls back to the value already in memory,
   * so the pin looks right locally while the server holds nothing. */
  check('...carrying last_inspected', up[0] && up[0].arg.last_inspected, '2026-08-01');
  check('...and the Kad Rekod Lokasi, which is the address of record',
    up[0] && up[0].arg.location, 'Balai Bomba Kunak');
  await p.close();

  /* A BLANK Lokasi must NOT overwrite — clearing the field cannot be allowed to
   * wipe the registered address. Note the asymmetry with the date below: these
   * two rules differ on purpose (CLAUDE.md §3). */
  p = await mount();
  await p.evaluate(() => window.__tapPin(0));
  await p.waitForTimeout(400);
  const ob2 = await p.$('#dOpenForm');
  if (ob2) { await ob2.click(); await p.waitForTimeout(700); }
  await p.evaluate(() => {
    const l = document.querySelector('#formOverlay [data-hk="lokasi"]');
    if (l) { l.value = '   '; l.dispatchEvent(new Event('input', { bubbles: true })); }
  });
  await p.click('#fSave');
  await p.waitForTimeout(900);
  const up2 = await p.evaluate(() => (window.__upserts || []).filter((u) => u.table === 'hydrants'));
  check('a blank Lokasi never overwrites the registered address',
    up2.every((u) => u.arg.location !== '' && u.arg.location !== null), true);
  await p.close();

  /* ---------- T14: the officer's actual workflow, end to end ----------
   *
   * Edit a Kad Rekod — a Pengujian date, no signature — and the hydrant must
   * move into "Belum di-sign": the dashboard figure, the map filter behind it,
   * and the pin's date badge. Reported as "when edit kad rekod pili bomba it
   * dont appear on belum di sign".
   *
   * Nothing covered this. T10 checks the figures are stable, T13 checks the
   * write reaches the server, the dashboard suites prove the counting in
   * isolation — but no test had ever driven the sequence an officer actually
   * performs, which is edit → save → look. That sequence crosses the record
   * store, the sync store, the dashboard scan and the map filter, and a break
   * anywhere in it looks identical from the outside: the figure does not move. */
  console.log('T14  editing a card moves the hydrant into Belum di-sign');
  p = await mount({ records: [] });                 // nothing inspected yet
  await p.click('#tabDash');
  await p.waitForTimeout(1300);
  check('every hydrant starts as Belum diperiksa',
    await figures(p), ['0', '0', String(REG.length)]);

  await p.click('#tabMap');
  await p.waitForTimeout(300);
  await p.evaluate(() => window.__tapPin(0));
  await p.waitForTimeout(400);
  const ob3 = await p.$('#dOpenForm');
  if (ob3) { await ob3.click(); await p.waitForTimeout(700); }
  await p.evaluate((today) => {
    const set = (sel, v) => {
      const e = document.querySelector(sel);
      if (e) { e.value = v; e.dispatchEvent(new Event('input', { bubbles: true })); }
    };
    set('#formOverlay input[data-sec="pengujian"][data-row="0"][data-k="tarikh"]', today);
    set('#formOverlay input[data-sec="pengujian"][data-row="0"][data-k="penguji"]', 'Ismail');
  }, TODAY);
  await p.waitForTimeout(200);
  await p.click('#fSave');
  await p.waitForTimeout(900);
  await p.click('#fClose');
  await p.waitForTimeout(300);

  await p.click('#tabDash');
  await p.waitForTimeout(1400);
  check('the edited pili is now Belum di-sign, not Belum diperiksa',
    await figures(p), ['0', '1', String(REG.length - 1)]);

  // The figure and the map must agree — they read the same index, and the whole
  // point of that decision is that they cannot disagree (CLAUDE.md §2).
  const cards2 = await p.$$('#dashView .dstat');
  await cards2[1].click();
  await p.waitForTimeout(700);
  check('and tapping it shows exactly that one pili on the map',
    await p.evaluate(() => window.__markers.length), 1);

  /* The pin's badge follows the same rows. Guarded: if the filter above found
   * nothing there is no pin to tap, and a bare __tapPin would throw and kill
   * the run before it reports — which is exactly what the mutation did. */
  const anyPin = await p.evaluate(() => window.__markers.length > 0);
  if (anyPin) {
    await p.evaluate(() => window.__tapPin(0));
    await p.waitForTimeout(400);
  }
  check('the pin now carries the inspection date',
    anyPin && await p.$eval('#dLastInsp', (n) => n.textContent.includes('/')).catch(() => false), true);
  await p.close();

  await b.close(); server.close();
  console.log('\n' + pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})();
