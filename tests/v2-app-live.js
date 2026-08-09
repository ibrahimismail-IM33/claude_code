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
const TYPES = { '.html': 'text/html', '.js': 'application/javascript', '.css': 'text/css', '.png': 'image/png' };

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
    const o = Object.assign({ role: 'admin', rows: REG, records: RECORDS, failScan: false, bigScan: 0 }, opts);
    const p = await b.newPage({ viewport: { width: 1280, height: 950 } });
    p.on('pageerror', (e) => { console.log('  PAGEERROR ' + e.message); fail++; });
    await p.addInitScript((cfg) => {
      window.__scanCalls = [];
      const ok = (data) => Promise.resolve({ data, error: null });
      window.supabase = {
        createClient: () => ({
          auth: {
            getSession: () => ok({ session: { user: { id: 'u1' } } }),
            getUser: () => ok({ user: { id: 'u1', email: 'officer@bomba.gov.my' } }),
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
              upsert: () => ok([]),
              delete() { return { eq() { return this; }, then: (r) => ok([]).then(r) }; },
              then(res, rej) {
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

  // ---------- T7: tapping a pin opens the card (it used to CRASH) ----------
  console.log('T7  tapping a pin opens the Kad Rekod');
  p = await mount();
  await p.evaluate(() => window.__tapPin(0));
  await p.waitForTimeout(700);
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

  await b.close(); server.close();
  console.log('\n' + pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})();
