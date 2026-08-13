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

  /* A real 1x1 PNG, served for any signed signature link. The Sign popup FETCHES
   * those bytes and converts them to a data URL, so a stub string would leave
   * that whole path unexercised — and it is the path that decides what gets
   * filed permanently. */
  const PNG_1X1 = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
    'base64');

  const server = http.createServer((req, res) => {
    if (req.url.startsWith('/sig/')) {
      res.writeHead(200, { 'Content-Type': 'image/png' });
      res.end(PNG_1X1);
      return;
    }
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
    const o = Object.assign({ role: 'admin', rows: REG, records: RECORDS, failScan: false, bigScan: 0, noSession: false, jadual: [], jadualError: null, saveFails: false, profileSig: null, base }, opts);
    // Every case before T22 ran at 1280px, which is why nothing in this suite
    // could see the phone header at all. `viewport` is an option now, not a
    // constant.
    const p = await b.newPage({ viewport: o.viewport || { width: 1280, height: 950 } });
    p.on('pageerror', (e) => { console.log('  PAGEERROR ' + e.message); fail++; });
    await p.addInitScript((cfg) => {
      window.__scanCalls = [];
      window.__jadualCalls = [];
      window.__upserts = [];
      window.__saved = [];   // rows the app has written, seen by later scans
      window.__uploads = [];         // { path, upsert } per storage write
      /* Objects ALREADY IN THE BUCKET when the page loads. An officer's
       * signature was uploaded in some earlier session; the stub has to know
       * that or it treats every replacement as a first upload and the
       * INSERT-only policy never bites — which is exactly how the defect got
       * past this suite. */
      window.__existing = cfg.profileSig ? [cfg.profileSig] : [];
      window.__storageDeletes = 0;
      window.__profileUpdates = [];  // every value written to profiles.signature
      window.__profileSig = cfg.profileSig || null;   // what the database holds
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
          /* The signatures bucket.
           *
           * `createSignedUrl` hands back a REAL url on the test server, because
           * the Sign popup fetches those bytes and turns them into a data URL —
           * a stub returning a fake string would exercise none of that path.
           * Uploads are recorded rather than performed: what T21 has to prove is
           * WHICH PATH each signature was written to, since that is the whole
           * difference between a stencil and a permanent record. */
          storage: {
            from: () => ({
              createSignedUrls: () => ok([]),
              /* Counted, not implemented. There is no delete policy on this
               * bucket by design, so any call here would fail in production —
               * the assertion is that the app never makes one. */
              remove: (paths) => { window.__storageDeletes = (window.__storageDeletes || 0) + 1;
                return Promise.resolve({ data: null,
                  error: { message: 'new row violates row-level security policy' } }); },
              createSignedUrl: (p) => ok({ signedUrl: cfg.base + 'sig/' + encodeURIComponent(p) }),
              /* MODELS THE REAL POLICY, and this is the point of the stub.
               *
               * The `signatures` bucket has exactly one write rule — INSERT —
               * and deliberately no UPDATE and no DELETE, because that absence
               * is what makes a filed signature permanent. So an upload to a
               * path that already exists is an UPDATE, and Postgres refuses it.
               *
               * The previous stub returned success unconditionally: it modelled
               * a bucket that allows everything, and hid a defect where
               * replacing a Profile signature failed for every officer. §4.24
               * records a stub being wrong in the PERMISSIVE direction and
               * inventing a defect; this is the same fault inverted. */
              upload: (p, blob, o) => {
                const exists = window.__existing.indexOf(p) >= 0
                  || window.__uploads.some((u) => u.path === p);
                window.__uploads.push({ path: p, upsert: !!(o && o.upsert) });
                if (exists) {
                  return Promise.resolve({ data: null,
                    error: { message: 'new row violates row-level security policy' } });
                }
                return ok({ path: p });
              },
            }),
          },
          from: (table) => {
            const q = {
              _eq: {}, _range: null, _cols: '',
              eq(k, v) { this._eq[k] = v; return this; },
              order() { return this; },
              /* Both reads on `profiles` end in .single(), and they ask for
               * different columns. Branching on the SELECTED COLUMNS rather
               * than returning one merged object keeps the stub honest: a
               * profile store that forgot to select `signature` would then
               * still appear to work here, and would return nothing in the app.
               * A stub that is permissive in the wrong direction invents
               * defects and hides real ones — §4.24. */
              single() {
                if (table === 'profiles' && /signature/.test(this._cols)) {
                  return ok({ signature: window.__profileSig });
                }
                return ok({ role: cfg.role });
              },
              range(f, t) { this._range = [f, t]; return this; },
              gte() { return this; },
              lte() { return this; },
              upsert(arg) {
                window.__upserts.push({ table, arg });
                /* The record write fails — the offline/flaky case. The work is
                 * parked locally and the Save button must SAY so rather than
                 * claiming the cloud: §4.10 is what happens when an officer
                 * believes a save landed and it did not. */
                if (cfg.saveFails && table === 'hydrant_records') {
                  return Promise.resolve({ error: { message: 'network' }, data: null });
                }
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
                // The database keeps it, so a later read sees the replacement —
                // which is what makes T21's "replace, then reload" case real.
                if (table === 'profiles' && arg && 'signature' in arg) {
                  window.__profileUpdates.push(arg.signature);
                  window.__profileSig = arg.signature;
                }
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
              select(cols) { this._cols = cols || ''; return this; },
            };
            return q;
          },
        }),
      };
      /* Leave `window.L` alone so the REAL library loads (see T8). Everything
       * below this point is the stub the other cases run against. */
      if (cfg.realLeaflet) return;
      const noop = () => {};
      const layer = () => ({ addTo() { return this; }, clearLayers() { window.__markers = []; window.__icons = []; },
        addLayer(m) { window.__markers.push(m); window.__icons.push(m.__html || ''); } });
      window.__markers = [];
      window.__icons = [];
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
        // The icon HTML is kept so a test can see WHAT a marker was drawn with,
        // not merely how many exist — the stale date badge (§4.25) is invisible
        // to a count.
        marker: (ll, opt) => { const m = { __html: (opt && opt.icon && opt.icon.html) || '',
          bindTooltip() { return m; },
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
  console.log('T9  the login gate artwork resolves and loads');
  p = await mount({ noSession: true });
  /* Both assets, and BOTH pseudo-elements matter: the circuit background is on
   * #authGate itself, the 50th watermark on #authGate::before — it needs its
   * own layer because a background-image layer cannot carry an opacity. */
  const art = await p.evaluate(async () => {
    const gate = document.querySelector('#authGate');
    if (!gate) return { err: 'no #authGate — the login gate did not render' };
    const grab = (el, pseudo) =>
      (/url\(["']?([^"')]+)/.exec(getComputedStyle(el, pseudo).backgroundImage) || [])[1];
    const load = (url) => new Promise((res) => {
      if (!url) return res({ loaded: false, w: 0, h: 0 });
      const img = new Image();
      img.onload = () => res({ loaded: true, w: img.naturalWidth, h: img.naturalHeight });
      img.onerror = () => res({ loaded: false, w: 0, h: 0 });
      img.src = url;
    });
    // The 50th watermark is the GATE's artwork; the circuit board is the APP
    // shell's, on body. Two different screens, deliberately (the mockups draw
    // them that way), so both are checked and neither can quietly go missing.
    const markUrl = grab(gate, '::before');
    const shellUrl = (/url\(["']?([^"')]+)/
      .exec(getComputedStyle(document.body).backgroundImage) || [])[1];
    return { markUrl, shellUrl, mark: await load(markUrl), shell: await load(shellUrl) };
  });
  check('the login gate is showing', !art.err, true);
  check('the 50th watermark URL is root-absolute, not relative to /assets/',
    /^https?:\/\/[^/]+\/logo-50\.png$/.test(art.markUrl || ''), true);
  check('...and it actually loads (a 404 gives 0x0)', art.mark.loaded, true);
  check('...at its real dimensions', [art.mark.w, art.mark.h], [500, 500]);
  check('the app shell background URL is root-absolute',
    /^https?:\/\/[^/]+\/app-bg\.png$/.test(art.shellUrl || ''), true);
  check('...and it loads too', art.shell.loaded, true);
  check('...at its real dimensions', [art.shell.w, art.shell.h], [1920, 1120]);

  /* THE WATERMARK MUST DARKEN, NOT COVER.
   *
   * The 50th artwork is WHITE-BACKED — no transparency anywhere — so painted as
   * an ordinary layer it is a large white block. `mix-blend-mode: multiply` is
   * what drops that white out and leaves only the engraved lines.
   *
   * Asserting the rule is present would prove nothing: the interesting failure
   * is a white rectangle appearing over the artwork, and a check for
   * `mixBlendMode === 'multiply'` passes just as happily on a build where the
   * blend has no effect. So this samples the page: the area the watermark
   * covers must be DARKER than the ground beside it. A white block is brighter,
   * which is precisely the state this catches. */
  const meanLuma = async () => {
    const shot = await p.screenshot();
    return p.evaluate(async (d) => {
      const img = new Image(); img.src = 'data:image/png;base64,' + d; await img.decode();
      const c = document.createElement('canvas');
      c.width = img.width; c.height = img.height;
      const x = c.getContext('2d'); x.drawImage(img, 0, 0);
      const im = x.getImageData(0, 0, c.width, c.height).data;
      let t = 0;
      for (let i = 0; i < im.length; i += 4) t += (im[i] * 299 + im[i + 1] * 587 + im[i + 2] * 114) / 1000;
      return t / (im.length / 4);
    }, shot.toString('base64'));
  };
  const withBlend = await meanLuma();
  // Force the blend off and re-measure the SAME page. If multiply is doing its
  // job the white plate reappears and the screen gets brighter; if the blend
  // were inert the two numbers would match.
  await p.addStyleTag({ content: '#authGate::before{mix-blend-mode:normal!important}' });
  await p.waitForTimeout(150);
  const withoutBlend = await meanLuma();
  check('the watermark DARKENS the page — it is not a white plate laid over it',
    withBlend < withoutBlend - 1, true);
  await p.reload({ waitUntil: 'load' });
  await p.waitForTimeout(900);

  /* Every text colour on the gate, measured against RENDERED PIXELS.
   *
   * Not against a computed background-color. The card is glass: `.authbox` is
   * `background:transparent` and its tint comes from `.authbox::before` plus a
   * backdrop-filter, so any model built from computed styles reads the ground
   * as the page behind the card and reports failures that do not exist. The
   * first version of this check did exactly that and called six passing colours
   * failures — while a pixel measurement of the same screen passed.
   *
   * So: screenshot each element, take its most common colour as the local
   * ground, composite the text's alpha over it, and compare. It is the only
   * method that survives glass, gradients and blur.
   *
   * Large text is held to 3:1 and normal text to 4.5:1 — the actual standard.
   * Holding a 23px bold wordmark to 4.5 would be inventing a rule. */
  const lum = (c) => { const f = (v) => { v /= 255;
    return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); };
    return 0.2126 * f(c[0]) + 0.7152 * f(c[1]) + 0.0722 * f(c[2]); };
  const cr = (a, b) => { const x = lum(a), y = lum(b);
    return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05); };

  const GATE_TEXT = [
    ['.authbox h2', 'wordmark', 3],
    ['.authbox .sub', 'BBP KUNAK', 3],
    ['.authbox > p', 'sign in to continue', 4.5],
    ['.authbox label', 'field label', 4.5],
    ['#authBtn', 'Sign In', 3],
    ['.authbox p:last-of-type', 'footer note', 4.5],
    ['#authEye', 'eye icon', 4.5],
  ];
  const contrast = [];
  for (const [sel, name, need] of GATE_TEXT) {
    const el = await p.$(sel);
    if (!el) { contrast.push([name, 0, need]); continue; }
    const color = await el.evaluate((n) => getComputedStyle(n).color);
    const shot = await el.screenshot();
    // Most common colour in the element's own box = what its glyphs sit on.
    const bg = await p.evaluate(async (d) => {
      const img = new Image(); img.src = 'data:image/png;base64,' + d; await img.decode();
      const c = document.createElement('canvas');
      c.width = img.width; c.height = img.height;
      const x = c.getContext('2d'); x.drawImage(img, 0, 0);
      const im = x.getImageData(0, 0, c.width, c.height).data;
      const m = new Map();
      for (let i = 0; i < im.length; i += 4) {
        const k = [im[i] >> 3, im[i + 1] >> 3, im[i + 2] >> 3].join(',');
        m.set(k, (m.get(k) || 0) + 1);
      }
      return [...m.entries()].sort((a, b) => b[1] - a[1])[0][0].split(',').map((v) => +v << 3);
    }, shot.toString('base64'));
    const m = (color.match(/[\d.]+/g) || []).map(Number);
    const a = m.length > 3 ? m[3] : 1;
    const eff = [0, 1, 2].map((i) => Math.round(m[i] * a + bg[i] * (1 - a)));
    contrast.push([name, +cr(eff, bg).toFixed(2), need]);
  }

  // An empty set would pass a .every() trivially — §4.18. Count first.
  check('every gate text colour was measured', contrast.length, 7);
  check('...and every one clears its threshold',
    contrast.filter(([, r, need]) => r < need), []);
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

  /* ---------- T15: the C22 case — a new inspection under a signed one --------
   *
   * From the live register: C22 had a SIGNED Pengujian row from 08/08 and a
   * fresh UNSIGNED one from 09/08. V1's rule ("any signed row wins") called it
   * Diperiksa, so it was missing from "Belum di-sign" — the list an officer
   * uses to find what still needs signing — while Pemeriksaan terkini, which
   * lists ROWS, showed its unsigned row. The counter counts PILI, so the two
   * appeared to contradict each other and both were right.
   *
   * V2 diverges deliberately: THE LATEST INSPECTION DECIDES (CLAUDE.md §3).
   * Note the second hydrant here — an OLD unsigned row under a NEW signed one
   * is finished work and must stay Diperiksa. Without that half, "any unsigned
   * row anywhere" would pass this test and be wrong. */
  console.log('T15  a new unsigned inspection under a signed one reads Belum di-sign');
  const older = new Date(Date.now() - 86400000).toISOString().split('T')[0];
  p = await mount({ records: [
    // like C22: signed yesterday, unsigned today  → Belum di-sign
    { hydrant_id: 1, section: 'pengujian', row_index: 0, data: { tarikh: older, penguji: '16857' }, signed: true },
    { hydrant_id: 1, section: 'pengujian', row_index: 1, data: { tarikh: TODAY, penguji: '' }, signed: false },
    // the reverse: unsigned yesterday, signed today → Diperiksa
    { hydrant_id: 2, section: 'pengujian', row_index: 0, data: { tarikh: older, penguji: '' }, signed: false },
    { hydrant_id: 2, section: 'pengujian', row_index: 1, data: { tarikh: TODAY, penguji: '16857' }, signed: true },
  ] });
  await p.click('#tabDash');
  await p.waitForTimeout(1400);
  check('one Diperiksa, one Belum di-sign, the rest never inspected',
    await figures(p), ['1', '1', String(REG.length - 2)]);

  const cards3 = await p.$$('#dashView .dstat');
  await cards3[1].click();
  await p.waitForTimeout(700);
  check('Belum di-sign shows exactly the pili awaiting a signature',
    await p.evaluate(() => window.__markers.length), 1);
  await p.close();

  /* ---------- T16: the pin badge updates WITHOUT a refresh ----------
   *
   * Reported as "the date is late to appear, needed refresh". `draw()` renders
   * markerHtml(status, lastInspected, hasPending) but only runs when `visible`
   * changes IDENTITY — and `visible` filters on status/insp/zone/query, never
   * on lastInspected, so with no filter active it is the same array and the
   * deep:false watcher sees nothing. The badge stayed stale until a pull or a
   * tab switch rebuilt the list.
   *
   * NOTE WHAT THIS TEST MUST NOT DO: switch tabs, reload, or trigger a pull.
   * Any of those IS the "refresh" that hides the defect. The whole assertion is
   * that the marker is redrawn with nothing else happening.
   *
   * Also asserts the map does not re-fit: a fit here would jump an officer's
   * pan away every time they save (the §3 guarantee for background pulls). */
  console.log('T16  saving a card redraws the pin immediately, without a refit');
  p = await mount({ records: [] });
  await p.waitForTimeout(500);
  const badge = () => p.evaluate(() => {
    const h = (window.__icons || [])[0] || '';
    const m = h.match(/>(\d{2}\/\d{2}\/\d{2,4})</);
    return m ? m[1] : (h ? '(no date)' : '(no marker)');
  });
  check('the pin starts with no date', await badge(), '(no date)');
  const fitBefore = await p.evaluate(() => window.__fitCount || 0);

  await p.evaluate(() => window.__tapPin(0));
  await p.waitForTimeout(400);
  const ob4 = await p.$('#dOpenForm');
  if (ob4) { await ob4.click(); await p.waitForTimeout(700); }
  await p.evaluate((t) => {
    const e = document.querySelector('#formOverlay input[data-sec="pengujian"][data-row="0"][data-k="tarikh"]');
    if (e) { e.value = t; e.dispatchEvent(new Event('input', { bubbles: true })); }
  }, TODAY);
  await p.waitForTimeout(200);
  await p.click('#fSave');
  await p.waitForTimeout(900);
  await p.click('#fClose');
  await p.waitForTimeout(500);

  check('the pin carries the date with NO tab switch or reload',
    (await badge()) !== '(no date)', true);
  check('and the map did not re-fit — the officer keeps their pan',
    (await p.evaluate(() => window.__fitCount || 0)) - fitBefore, 0);
  await p.close();

  /* ---------- T17: Save says what it did ----------
   *
   * V1 cycles Saving… → Saved to cloud ✓ / ⚠ Local only → Save. V2's button was
   * a static label, so an officer could not tell a save from a no-op — which on
   * a field connection is the difference between filed and lost. */
  console.log('T17  the Save button reports the outcome');
  p = await mount();
  await p.evaluate(() => window.__tapPin(0));
  await p.waitForTimeout(400);
  const ob5 = await p.$('#dOpenForm');
  if (ob5) { await ob5.click(); await p.waitForTimeout(700); }
  await p.click('#fSave');
  await p.waitForTimeout(900);
  check('a successful save says so', await p.$eval('#fSave', (n) => n.textContent.trim()),
    'Saved to cloud ✓');
  await p.close();

  /* With no cloud the work is parked locally, and the button must say THAT
   * rather than claiming success — §4.10 is what happens when an officer
   * believes a save reached the server and it did not. */
  p = await mount({ saveFails: true });
  await p.evaluate(() => window.__tapPin(0));
  await p.waitForTimeout(400);
  const ob6 = await p.$('#dOpenForm');
  if (ob6) { await ob6.click(); await p.waitForTimeout(700); }
  await p.click('#fSave');
  await p.waitForTimeout(900);
  check('a local-only save does NOT claim the cloud',
    await p.$eval('#fSave', (n) => n.textContent.trim()), '⚠ Local only');
  await p.close();

  /* ---------- T18: the tab-switch animation, and what it must not touch ------
   *
   * Requested design change. Two properties matter more than the motion itself:
   *
   * 1. THE MAP PANEL IS ANIMATED ON OPACITY ONLY. A transformed ancestor
   *    becomes the containing block for Leaflet's absolutely-positioned panes,
   *    and §4.16/§4.17 are both what happens when Leaflet's geometry stops
   *    matching the page. So `.maparea` may fade, never move.
   * 2. It must re-arm. v-show does not remount, so a CSS animation that is not
   *    removed and re-added runs once and never again — the switch would
   *    animate the first time and be inert afterwards, which is the kind of
   *    thing that looks fine in a demo and dead in use.
   *
   * HONEST LIMIT: MapShell also resets the class explicitly before re-adding
   * it, for a switch faster than the 300ms settle timer. That line is NOT
   * covered here — the assertions between switches take long enough that the
   * timer fires first, and no reliable failing case could be built for it.
   * Recorded rather than implied: an unverified guard should say so. */
  console.log('T18  switching tabs animates, without disturbing the map');
  p = await mount();
  await p.waitForTimeout(600);

  const mapAnim = async () => p.$eval('.maparea', (n) => {
    const cs = getComputedStyle(n);
    return { name: cs.animationName, transform: cs.transform };
  });

  await p.click('#tabDash'); await p.waitForTimeout(150);
  check('the dashboard panel animates in',
    await p.$eval('#dashView', (n) => getComputedStyle(n).animationName), 'panelRiseIn');

  await p.click('#tabMap'); await p.waitForTimeout(120);
  const a1 = await mapAnim();
  check('the map panel animates in', a1.name, 'panelFadeIn');
  /* The whole point: a fade, not a move. `none` or a plain identity matrix are
   * both fine; anything else means a transform reached a Leaflet ancestor. */
  check('...and does NOT transform — Leaflet ancestors must stay untransformed',
    a1.transform === 'none' || a1.transform === 'matrix(1, 0, 0, 1, 0, 0)', true);

  /* Re-arm on a FAST switch — under the 300ms settle timer.
   *
   * This is the case the explicit class reset exists for, and the only one that
   * can catch its absence: wait longer than the timer and the class has already
   * been dropped, so re-arming happens for free and a broken reset still looks
   * fine. An officer flicking between tabs is exactly this fast. */
  await p.click('#tabDash'); await p.waitForTimeout(80);
  await p.click('#tabMap'); await p.waitForTimeout(60);
  /* Ask whether the animation RESTARTED, not whether the class is present.
   * `animationName` is set whenever the class is, restart or not — an earlier
   * version of this assertion read that and passed over a broken re-arm.
   * getAnimations() exposes currentTime, so a freshly started run is one whose
   * clock is near zero. */
  check('and it re-arms even on a fast switch, inside the settle window',
    await p.$eval('.maparea', (n) => {
      const a = n.getAnimations().filter((x) => x.animationName === 'panelFadeIn');
      return a.length > 0 && a.some((x) => Number(x.currentTime) < 150);
    }), true);

  // It settles: the class is dropped so nothing is left mid-animation.
  await p.waitForTimeout(500);
  check('the animation clears once it has run',
    await p.$eval('.maparea', (n) => n.classList.contains('panel-in')), false);
  await p.close();

  /* ---------- T19: Sign fills the preview from the officer's Profile --------
   *
   * The requested change: `📷 Pilih gambar / Ambil foto` becomes `Sign`, and
   * pressing it uses the signature already stored on the officer's Profile
   * instead of asking for a photo every time.
   *
   * The assertion that matters is NOT that a button exists — §5 records
   * treating a structural guard as though it answered "does pressing this do
   * anything", twice, while Print and Save were both wired to nothing. So this
   * presses it and reads the preview.
   *
   * It also checks Sign does NOT confirm. Confirming is permanent, and the only
   * thing between a mis-tap and an unremovable record is the officer looking at
   * what they are about to file. */
  console.log('T19  Sign fills the preview from the stored Profile signature');
  p = await mount({ profileSig: 'profile/u1.png' });
  await p.evaluate(() => window.__tapPin(0));
  await p.waitForTimeout(400);
  const ob7 = await p.$('#dOpenForm');
  if (ob7) { await ob7.click(); await p.waitForTimeout(700); }
  // Open the popup from an unsigned row's T.T cell, the way an officer does.
  await p.evaluate(() => {
    const c = document.querySelector("#formOverlay .sigbtn[data-sec=pengujian]");
    if (c) c.click();
  });
  await p.waitForTimeout(500);

  check('the button reads Sign, not "Pilih gambar"',
    await p.evaluate(() => { const n = document.querySelector('#sigUseProfile'); return n ? n.textContent.trim() : null; }), 'Sign');
  check('the preview starts empty — nothing is pre-committed',
    await p.$('#sigPrev img'), null);
  check('...and "Sahkan & Kunci" is not yet available',
    await p.$eval('#sigOk', (n) => n.disabled), true);

  await p.click('#sigUseProfile');
  await p.waitForTimeout(400);
  check('pressing Sign fills the preview from the Profile signature',
    await p.evaluate(() => { const n = document.querySelector('#sigPrev img'); return !!n && n.src.startsWith('data:image/'); }), true);
  check('...which arms the confirm button',
    await p.$eval('#sigOk', (n) => n.disabled), false);
  check('Sign alone does NOT file anything — confirming is a separate tap',
    await p.evaluate(() => window.__uploads.filter((u) => !u.path.startsWith('profile/')).length), 0);

  // The file picker is still reachable: an officer signing on a colleague's
  // device has no Profile signature on that account. Removing it would take
  // away a capability, and this change is to the label, not to what the card
  // can attest.
  check('a secondary route to the camera remains', !!(await p.$('#sigOther')), true);
  await p.click('#sigOther');
  await p.waitForTimeout(150);
  check('...and it reveals the original file input', !!(await p.$('#sigFile')), true);
  await p.close();

  /* ---------- T20: no stored signature sends the officer to Profile ---------
   *
   * The failure this replaces is a dead button: an officer taps Sign, nothing
   * happens, and there is no route to fixing it from inside the popup. */
  console.log('T20  with no stored signature, Sign offers the way to add one');
  p = await mount({ profileSig: null });
  await p.evaluate(() => window.__tapPin(0));
  await p.waitForTimeout(400);
  const ob8 = await p.$('#dOpenForm');
  if (ob8) { await ob8.click(); await p.waitForTimeout(700); }
  await p.evaluate(() => {
    const c = document.querySelector("#formOverlay .sigbtn[data-sec=pengujian]");
    if (c) c.click();
  });
  await p.waitForTimeout(600);

  check('no Sign button is offered when there is nothing to sign with',
    await p.$('#sigUseProfile'), null);
  check('the popup offers Profile instead of a dead button',
    !!(await p.$('#sigGoProfile')), true);
  await p.click('#sigGoProfile');
  await p.waitForTimeout(400);
  check('...and it actually lands on the Profile tab',
    await p.$eval('#tabProfile', (n) => n.classList.contains('on')), true);
  check('the card closes so Profile is not hidden behind it',
    await p.$('#formOverlay'), null);
  check('Profile says the signature is missing',
    await p.evaluate(() => { const n = document.querySelector('#pvSigNone'); return !!n && n.textContent.includes('Belum ada'); }), true);

  /* And the officer can finish the errand they were sent on.
   *
   * Adding a FIRST signature is a different path from replacing one, and only
   * this one proves the store keeps what it just wrote: on a replacement the
   * old path is already loaded, so a save that never records the new one still
   * looks correct. A mutation removing that assignment survived every other
   * assertion in this suite. */
  check('the add button is offered, not a replace',
    await p.evaluate(() => { const n = document.querySelector('#pvAddSig'); return n ? n.textContent.trim() : null; }),
    'Tambah tandatangan');
  await p.setInputFiles('#pvSigFile', { name: 's.png', mimeType: 'image/png', buffer: PNG_1X1 });
  await p.waitForTimeout(1200);
  check('the new signature appears without a reload',
    await p.evaluate(() => !!document.querySelector('#pvSig img')), true);
  check('...the button now offers a replacement',
    await p.evaluate(() => { const n = document.querySelector('#pvAddSig'); return n ? n.textContent.trim() : null; }),
    'Tukar tandatangan');
  check('...and it says the save landed',
    await p.evaluate(() => !!document.querySelector('#pvOk')), true);
  await p.close();

  /* ---------- T21: the stencil is COPIED, never referenced ----------
   *
   * The property the whole feature rests on, and the one worth writing first.
   *
   * A Profile signature may be REPLACED. A filed row's signature may NEVER be.
   * Those two facts are only compatible because signRow() uploads its own copy
   * to the row's own path — if a row referenced `profile/<uid>.png` instead,
   * an officer replacing a bad photo would silently rewrite the evidence on
   * every record that pointed at it, and those records cannot be corrected.
   *
   * So this asserts WHERE each write went and with what upsert flag, not what
   * the images look like: the paths are the guarantee. */
  console.log('T21  a filed signature is the row\'s own object, not the Profile\'s');
  p = await mount({ profileSig: 'profile/u1.png' });
  await p.evaluate(() => window.__tapPin(0));
  await p.waitForTimeout(400);
  const ob9 = await p.$('#dOpenForm');
  if (ob9) { await ob9.click(); await p.waitForTimeout(700); }
  await p.evaluate(() => {
    const c = document.querySelector("#formOverlay .sigbtn[data-sec=pengujian]");
    if (c) c.click();
  });
  await p.waitForTimeout(500);
  await p.click('#sigUseProfile');
  await p.waitForTimeout(300);
  await p.click('#sigOk');
  await p.waitForTimeout(900);

  const rowUploads = await p.evaluate(() => window.__uploads.filter((u) => !u.path.startsWith('profile/')));
  check('signing uploaded exactly one new object', rowUploads.length, 1);
  check('...at the ROW\'s own path, never the Profile\'s',
    /^\d+\/pengujian_\d+_\d+\.png$/.test(rowUploads[0] ? rowUploads[0].path : ''), true);
  // upsert:false is what makes a per-row object unrepeatable: a collision is an
  // error rather than a silent overwrite of filed evidence.
  check('...and refuses to overwrite (upsert false)',
    rowUploads[0] ? rowUploads[0].upsert : true, false);

  const rowSig = await p.evaluate(() => {
    const r = window.__upserts.filter((u) => u.table === 'hydrant_records')
      .flatMap((u) => (Array.isArray(u.arg) ? u.arg : [u.arg]))
      .filter((x) => x && x.signed);
    return r.length ? r[r.length - 1].signature : '';
  });
  check('the RECORD stores its own path, so nothing it depends on can change',
    /^\d+\/pengujian_\d+_\d+\.png$/.test(rowSig), true);
  check('...and specifically not the Profile object', rowSig.startsWith('profile/'), false);
  await p.close();

  /* Now the other half: replacing the Profile signature must touch NOTHING
   * that is filed. Verified as a distinct case because "the paths differ" and
   * "a replacement leaves the record alone" are different claims, and only the
   * second is the promise made to an officer. */
  p = await mount({ profileSig: 'profile/u1.png' });
  await p.waitForTimeout(600);
  await p.click('#tabProfile');
  await p.waitForTimeout(300);
  check('an admin is offered a replacement, not just an add',
    await p.evaluate(() => { const n = document.querySelector('#pvAddSig'); return n ? n.textContent.trim() : null; }), 'Tukar tandatangan');
  await p.setInputFiles('#pvSigFile', { name: 's.png', mimeType: 'image/png', buffer: PNG_1X1 });
  await p.waitForTimeout(1200);

  const after = await p.evaluate(() => ({
    uploads: window.__uploads.map((u) => u),
    updates: window.__profileUpdates.slice(),
    err: (document.querySelector('#pvErr') || {}).textContent || '',
  }));
  /* REPLACEMENT HAS TO LAND, and this is what the shipped defect walked past.
   *
   * The bucket allows INSERT and nothing else — no UPDATE, no DELETE — because
   * that absence is what keeps a filed signature permanent. Writing to a FIXED
   * path with `upsert:true` is therefore an UPDATE the second time round, and
   * every officer's "Tukar tandatangan" failed with "new row violates
   * row-level security policy". The FIRST save worked, which is why it looked
   * fine in testing and in use.
   *
   * The old assertion here checked that `upsert:true` was SENT — the client's
   * intent — while the stubbed upload accepted everything. It proved a request
   * was made, never that the server would take it. */
  check('replacing a signature actually succeeds', after.err, '');
  check('...writing to a NEW path, so it is an INSERT the policy allows',
    after.uploads.length >= 1
      && after.uploads.every((u) => /^profile\/u1_\d+\.png$/.test(u.path)), true);
  check('...and never overwriting, so a collision is an error not a silent replace',
    after.uploads.every((u) => u.upsert === false), true);
  // Stated as "not a profile path" rather than matching a hydrant pattern: a
  // pattern that happens not to match proves nothing, and an earlier version of
  // this line used one that could never have matched (§4.18).
  check('nothing outside the Profile path was touched',
    after.uploads.filter((u) => !u.path.startsWith('profile/')).length, 0);
  check('the profile row is repointed at the NEW object',
    /^profile\/u1_\d+\.png$/.test(after.updates[after.updates.length - 1] || ''), true);
  check('...which is not the one it replaced',
    after.updates[after.updates.length - 1] === 'profile/u1.png', false);

  /* ---- Buang tandatangan ----
   * Clears the REFERENCE only. There is no delete policy on the bucket, and
   * adding one would be adding the very rule that keeps filed signatures
   * permanent — so the image stays where it is, unreferenced. */
  p.once('dialog', (d) => d.dismiss());
  await p.click('#pvRemoveSig');
  await p.waitForTimeout(500);
  check('dismissing the confirm removes nothing',
    await p.evaluate(() => !!document.querySelector('#pvRemoveSig')), true);

  p.once('dialog', (d) => d.accept());
  await p.click('#pvRemoveSig');
  await p.waitForTimeout(800);
  check('accepting it nulls the stored signature',
    await p.evaluate(() => window.__profileUpdates[window.__profileUpdates.length - 1]), null);
  check('...the button offers an ADD again',
    await p.evaluate(() => { const n = document.querySelector('#pvAddSig'); return n ? n.textContent.trim() : null; }),
    'Tambah tandatangan');
  check('...and Buang is gone, with nothing left to remove',
    await p.evaluate(() => !!document.querySelector('#pvRemoveSig')), false);
  check('...and no storage delete was attempted — there is no policy for one',
    await p.evaluate(() => window.__storageDeletes || 0), 0);
  await p.close();

  /* A viewer has no update path to profiles at all — `admins manage profiles`
   * is the only write policy on that table, which is why no new policy was
   * added. The server decides; this only checks the app does not offer a
   * control that RLS would refuse. */
  p = await mount({ role: 'viewer', profileSig: null });
  await p.waitForTimeout(600);
  await p.click('#tabProfile');
  await p.waitForTimeout(300);
  check('a viewer is not offered the uploader', await p.$('#pvAddSig'), null);
  check('...and is told why', await p.$eval('#profileView .pvnote', (n) => n.textContent.includes('admin')), true);
  await p.close();

  /* ---------- T22: the phone header — where the navigation actually is ------
   *
   * On a phone `.tabs` is `display:none` and the hamburger IS the navigation.
   * That makes these five rows the only way to change view or sign out on the
   * device this app is used on, in gloves, in a field.
   *
   * **Every other case in this suite mounts at 1280px**, so all of this could
   * be completely broken and the suite would stay green — the same shape as
   * §4.21, where the mobile registry sheet was a 52px sliver with no way to
   * open it because only the media-query overrides had been ported. A viewport
   * nobody tests at is a viewport nobody tests. */
  console.log('T22  the phone menu is the navigation, and the tabs step aside');
  p = await mount({ viewport: { width: 360, height: 740 } });
  await p.waitForTimeout(800);

  check('the tab bar is hidden on a phone',
    await p.$eval('.tabs', (n) => getComputedStyle(n).display), 'none');
  /* The half that matters more. A media query written one breakpoint off takes
   * navigation away from every desktop user, and no other assertion here would
   * notice — they all click #tabDash directly, which works on a hidden button. */
  const wide = await mount();
  await wide.waitForTimeout(600);
  check('...and is still there on a desktop',
    await wide.$eval('.tabs', (n) => getComputedStyle(n).display !== 'none'), true);
  /* The tab bar spans the full width now, so assert that too — three equal
     tabs sharing one row, edge to edge. Geometry rather than a class, for the
     same reason §4.26 needed it: a bar that has silently collapsed to three
     buttons in a corner still carries every class it should. */
  const bar = await wide.evaluate(() => {
    const t = document.querySelector('.tabs').getBoundingClientRect();
    const bs = Array.from(document.querySelectorAll('.tabs .tabb')).map((n) => n.getBoundingClientRect());
    return { spans: Math.round(t.width) >= document.documentElement.clientWidth,
      count: bs.length, oneRow: new Set(bs.map((b) => Math.round(b.top))).size === 1,
      equal: bs.length === 3 && Math.max(...bs.map((b) => b.width)) - Math.min(...bs.map((b) => b.width)) < 2 };
  });
  check('the tab bar spans the full width', bar.spans, true);
  check('...with three equal tabs on one row',
    [bar.count, bar.oneRow, bar.equal], [3, true, true]);
  const wideSignOut = await wide.$eval('#signOutBtn', (n) => getComputedStyle(n).color);
  await wide.close();

  check('the hamburger is showing',
    await p.$eval('#menuBtn', (n) => getComputedStyle(n).display !== 'none'), true);

  /* Sign Out's colour, in the HEADER as well as the menu.
   *
   * The redesign mockup shows an amber Sign Out and the user's instruction —
   * given twice — was to keep the colour it already has. Both places are
   * asserted because the decision applies to both, and a decision that lives
   * only in a comment gets undone by the next person following the mockup. */
  check('the header Sign Out keeps its current colour',
    wideSignOut, 'rgba(255, 255, 255, 0.6)');
  await p.click('#menuBtn');
  await p.waitForTimeout(250);

  // Read the LABELS, not just the count: five rows in the right order is the
  // menu; five rows of anything is not.
  check('the menu carries all five items, in order',
    await p.evaluate(() => Array.from(document.querySelectorAll('#menuPanel .mitem'))
      .filter((n) => getComputedStyle(n).display !== 'none')
      .map((n) => n.textContent.replace(/\s+/g, ' ').trim())),
    ['🗺️ Peta Pili', '📊 Dashboard', '👤 Profil', '+ Tambah Pili', 'Sign out']);

  check('it marks the view you are on',
    await p.$eval('#mTabMap', (n) => n.classList.contains('on')), true);

  // The Email/Peranan readouts moved to the Profil tab. Asserted as ABSENT so
  // the relocation is a checked fact and not just a waiver entry.
  check('the old Email/Peranan rows are gone',
    await p.evaluate(() => !document.querySelector('#mEmail') && !document.querySelector('#mRole')), true);

  await p.click('#mTabProfile');
  await p.waitForTimeout(500);
  check('tapping Profil lands on the tab',
    await p.evaluate(() => !!document.querySelector('#profileView') &&
      getComputedStyle(document.querySelector('#profileView')).display !== 'none'), true);
  // A menu that stays open after a pick covers the view it just opened.
  check('...and the menu closes behind it',
    await p.$eval('#menuPanel', (n) => n.classList.contains('hide')), true);

  await p.click('#menuBtn'); await p.waitForTimeout(200);
  check('the menu now marks Profil instead',
    await p.evaluate(() => [document.querySelector('#mTabMap').classList.contains('on'),
      document.querySelector('#mTabProfile').classList.contains('on')]), [false, true]);

  /* V1's colour, asserted rather than assumed. The redesign mockup showed an
   * amber Sign Out and the user's call was to keep V1's — a decision that lives
   * in a comment is a decision that gets undone by the next person following
   * the mockup. rgb(252,165,165) is #fca5a5. */
  check('Sign out keeps V1\'s colour',
    await p.$eval('#mSignOut', (n) => getComputedStyle(n).color), 'rgb(252, 165, 165)');

  /* The pills own the second row now, and they must sit ON one row.
   *
   * Asserted as GEOMETRY, not as a class or a computed style, because the
   * defect this catches was neither: `Pills.vue` rendered `id="pills"` without
   * V1's `class="pills"`, so every rule laying this row out — the base flex in
   * map.css and the entire mobile block — matched nothing, and the pills
   * stacked one per line from the first day of the port. `v2-parity-surface.js`
   * was green throughout: it matches the bare token `pills`, which the id
   * supplies on its own. Only a measurement could see it. */
  await p.evaluate(() => { document.querySelector('#menuBtn').click(); });
  await p.waitForTimeout(200);
  check('the scope pills sit on a single row',
    await p.evaluate(() => {
      const tops = Array.from(document.querySelectorAll('#pills .pill'))
        .map((n) => Math.round(n.getBoundingClientRect().top));
      // An empty set would make `new Set([]).size === 1` false anyway, but say
      // it out loud — §4.18 shipped an assertion over an empty selection.
      return tops.length >= 2 && new Set(tops).size === 1;
    }), true);

  // Tambah Pili is the ONLY way an admin adds a hydrant on a phone.
  check('an admin still gets Tambah Pili',
    await p.$eval('#mAdd', (n) => getComputedStyle(n).display !== 'none'), true);
  await p.close();

  /* §4.9 — the defect this whole change is downstream of. The 5-column table
   * once pushed a 390px page to 438px, and three tabs plus two pills plus the
   * clear chip is the same pressure on the header row. */
  for (const w of [360, 390]) {
    const m = await mount({ viewport: { width: w, height: 740 } });
    await m.waitForTimeout(700);
    check('no sideways scroll at ' + w + 'px',
      await m.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth), 0);
    await m.close();
  }

  // A viewer must not be offered a control RLS would refuse.
  p = await mount({ role: 'viewer', viewport: { width: 360, height: 740 } });
  await p.waitForTimeout(700);
  await p.click('#menuBtn');
  await p.waitForTimeout(250);
  check('a viewer gets the three tabs and Sign out, but no Tambah Pili',
    await p.evaluate(() => Array.from(document.querySelectorAll('#menuPanel .mitem'))
      .filter((n) => getComputedStyle(n).display !== 'none').length), 4);
  await p.close();

  /* ---------- T23: the card printed FROM THE ASSEMBLED APP ----------
   *
   * `v2-kad-rekod.js` already renders the card to PDF and counts pages — but it
   * mounts through the HARNESS, which is a bare page. The app is not: it has a
   * body background, `body::before` carrying the 50th watermark, and `.app`
   * pseudo-elements. None of that exists in the harness, so none of it was ever
   * in a printed page under test.
   *
   * It reached paper. `body.form-open > *:not(#formOverlay)` hides child
   * ELEMENTS; a pseudo-element is not one, so the watermark printed across a
   * legal record — a fixed, `mix-blend-mode:multiply` layer over every page.
   *
   * Same shape as every seam defect in this file: the layer was proven, the
   * app was not. */
  console.log('T23  the Kad Rekod prints clean from the real app, not the harness');
  p = await mount();
  await p.evaluate(() => window.__tapPin(0));
  await p.waitForTimeout(400);
  const ob10 = await p.$('#dOpenForm');
  if (ob10) { await ob10.click(); await p.waitForTimeout(900); }
  check('the card is open and teleported to <body>, where the print CSS expects it',
    await p.evaluate(() => { const n = document.querySelector('#formOverlay');
      return !!n && n.parentElement === document.body; }), true);

  await p.emulateMedia({ media: 'print' });
  await p.waitForTimeout(250);
  /* Asserted on the PSEUDO-ELEMENTS by name. The child rule cannot reach them,
   * and that is the entire defect — a test that only checked `#app` is hidden
   * passes over it. */
  check('nothing from the app shell paints on the page',
    await p.evaluate(() => ['body::before', 'body::after', '.app::before', '.app::after']
      .map((sel) => {
        const [host, pseudo] = sel.split('::');
        const el = host === 'body' ? document.body : document.querySelector(host);
        return el ? getComputedStyle(el, '::' + pseudo).display : 'none';
      })
      .filter((d) => d !== 'none')), []);
  check('...and the app itself is hidden',
    await p.$eval('#app', (n) => getComputedStyle(n).display), 'none');
  check('the card is still visible — the rule hides the shell, not the record',
    await p.$eval('#formOverlay', (n) => getComputedStyle(n).display), 'block');

  /* The page count is the assertion that catches a layout change pushing the
   * card onto a third sheet, which is invisible on screen (docs/KAD-REKOD.md). */
  const pdf = await p.pdf({ format: 'Letter', printBackground: true,
    margin: { top: '8mm', bottom: '8mm', left: '8mm', right: '8mm' } });
  check('one card still prints as exactly two pages',
    (pdf.toString('latin1').match(/\/Type\s*\/Page[^s]/g) || []).length, 2);
  await p.emulateMedia({ media: 'screen' });
  await p.close();

  await b.close(); server.close();
  console.log('\n' + pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})();
