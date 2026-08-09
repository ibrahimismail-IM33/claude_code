/* Phase 2 gate, part 3 — see docs/V2-ROADMAP.md.
 *
 * The V2 dashboard COMPONENTS, mounted for real in Chromium and driven through
 * the DOM. The parity suites prove the arithmetic; this proves the thing an
 * officer actually looks at.
 *
 * It asserts against the selectors frozen in docs/DOM-CONTRACT.md, and mirrors
 * what tests/zone-panel.js asserts about V1 — same scenarios, same meanings —
 * so the two views can be compared claim for claim. It does NOT edit
 * zone-panel.js: that suite is V1's, it must keep passing unchanged, and a
 * suite adjusted to fit new code has stopped being evidence.
 *
 * Run:  V2_HARNESS=1 npx vite build && node tests/v2-dashboard-view.js
 *       (npm run test:v2dash does both)
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

// The register the sketch described, plus the two shapes the panel could lie
// about: a gap inside a range, and a label that does not parse.
function register() {
  const out = [];
  const add = (label, status) => out.push({ id: out.length + 1, label, status, location: 'Kunak' });
  for (let n = 1; n <= 114; n++) add('A' + String(n).padStart(2, '0'), (n === 26 || (n >= 92 && n <= 107)) ? 'swasta' : 'kerajaan');
  for (let n = 1; n <= 27; n++) add('B' + String(n).padStart(2, '0'), 'kerajaan');
  for (let n = 1; n <= 21; n++) add('C' + String(n).padStart(2, '0'), 'kerajaan');
  for (let n = 1; n <= 13; n++) add('D' + String(n).padStart(2, '0'), 'kerajaan');
  for (let n = 1; n <= 13; n++) add('E' + String(n).padStart(2, '0'), 'kerajaan');
  return out;
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
    const p = await b.newPage({ viewport: viewport || { width: 1280, height: 950 } });
    p.on('pageerror', (e) => { console.log('  PAGEERROR', e.message); fail++; });
    await p.addInitScript((f) => { window.__fixture = f; }, fixture);
    await p.goto(base, { waitUntil: 'load' });
    await p.waitForTimeout(250);
    return p;
  }

  const HYD = register();
  const YEAR = new Date().getFullYear();
  const IN = new Date().getMonth() < 6 ? YEAR + '-03-15' : YEAR + '-09-15';
  // 2 signed, 1 unsigned, the rest never inspected.
  const IDX = { 1: [{ d: IN, s: true, p: 'A' }], 2: [{ d: IN, s: true, p: 'B' }], 3: [{ d: IN, s: false, p: 'C' }] };

  // ---------- T1: the zone panel matches the register ----------
  console.log('T1  zone rows are derived from the register');
  let p = await mount({ hydrants: HYD, index: IDX });
  check('one row per zone', await p.$$eval('#dashZones .zrow', (n) => n.length), 5);
  check('zone letters', await p.$$eval('#dashZones .zk', (n) => n.map((x) => x.textContent)), ['A', 'B', 'C', 'D', 'E']);
  check('ranges', await p.$$eval('#dashZones .zr', (n) => n.map((x) => x.textContent.replace(/\s+/g, ' ').trim())),
    ['A01 – A114', 'B01 – B27', 'C01 – C21', 'D01 – D13', 'E01 – E13']);
  check('counts', await p.$$eval('#dashZones .zc', (n) => n.map((x) => x.textContent)),
    ['114 pili', '27 pili', '21 pili', '13 pili', '13 pili']);
  check('rows are buttons, not a table (§4.9)',
    await p.$$eval('#dashZones .zrow', (n) => n.every((x) => x.tagName === 'BUTTON')), true);
  check('no table anywhere in the panel', await p.$$eval('#dashZones table', (n) => n.length), 0);
  check('caption says it ignores the pills',
    await p.$eval('#dashZoneNote', (n) => /tidak mengikut penapis/.test(n.textContent)), true);
  await p.close();

  // ---------- T2: the panel ignores the Awam/Swasta pills ----------
  console.log('T2  the panel is the one thing that ignores the pills');
  p = await mount({ hydrants: HYD, index: IDX, statusFilter: 'swasta' });
  check('zone A still reports the whole register',
    await p.$eval('#dashZones .zc', (n) => n.textContent), '114 pili');
  check('range does not shrink to the Swasta block',
    await p.$eval('#dashZones .zr', (n) => n.textContent.replace(/\s+/g, ' ').trim()), 'A01 – A114');
  await p.close();

  // ---------- T3: the two ways the panel could lie ----------
  console.log('T3  a gap and an unparseable label are both reported');
  p = await mount({ hydrants: [
    { id: 1, label: 'A01', status: 'kerajaan' }, { id: 2, label: 'A02', status: 'kerajaan' },
    { id: 3, label: 'A09', status: 'kerajaan' }, { id: 4, label: 'PILI BARU', status: 'kerajaan' },
  ], index: {} });
  check('the gapped zone is flagged in the markup',
    await p.$eval('#dashZones .zrow', (n) => n.classList.contains('zwarn')), true);
  check('the caption names the gap',
    await p.$eval('#dashZoneNote', (n) => /tidak berturutan/.test(n.textContent)), true);
  check('the unparseable label is counted, not hidden',
    await p.$eval('#dashZoneNote', (n) => /1 pili tidak mengikut format zon/.test(n.textContent)), true);
  check('and it gets no row of its own',
    await p.$$eval('#dashZones .zrow', (n) => n.length), 1);
  await p.close();

  // ---------- T4: an empty register ----------
  console.log('T4  an empty register says so');
  p = await mount({ hydrants: [], index: {} });
  check('no zone rows', await p.$$eval('#dashZones .zrow', (n) => n.length), 0);
  check('it says there are none', await p.$eval('#dashZones .znote', (n) => n.textContent), 'Tiada pili berdaftar.');
  await p.close();

  // ---------- T5: the figures ----------
  console.log('T5  figures are derived from the Pengujian rows');
  p = await mount({ hydrants: HYD, index: IDX });
  check('Diperiksa / Belum di-sign / Belum diperiksa',
    await p.$$eval('.dstat .num', (n) => n.map((x) => +x.textContent)), [2, 1, 185]);
  check('they reconcile to the register',
    await p.$$eval('.dstat .num', (n) => n.reduce((s, x) => s + +x.textContent, 0)), HYD.length);
  check('the donut centre carries the same total',
    await p.$eval('#dashDonut .center-n', (n) => +n.textContent), HYD.length);
  check('scope with no pill selected is Semua, not Awam (§4.3)',
    await p.$eval('#dashScope', (n) => n.textContent.trim()), 'Semua');
  await p.close();

  // ---------- T6: scope follows the pills ----------
  console.log('T6  the figures follow the Awam/Swasta pills');
  /* Totals are DERIVED from the fixture, not restated as constants. A first
   * version hardcoded 170 Awam from CLAUDE.md's 187-hydrant seed, but this
   * fixture follows the zone sketch (A01–A114 + 27 + 21 + 13 + 13 = 188), so
   * Awam is 171. That mismatch is the same one already noted in §3: the
   * sketch matched production while the repo seed was a row behind — which is
   * exactly why zones are derived and never stored. */
  for (const [filter, label] of [['kerajaan', 'Awam'], ['swasta', 'Swasta']]) {
    const total = HYD.filter((h) => h.status === filter).length;
    p = await mount({ hydrants: HYD, index: IDX, statusFilter: filter });
    check(label + ' · scope label', await p.$eval('#dashScope', (n) => n.textContent.trim()), label);
    check(label + ' · figures reconcile to that scope',
      await p.$$eval('.dstat .num', (n) => n.reduce((s, x) => s + +x.textContent, 0)), total);
    await p.close();
  }

  // ---------- T7: everything is clickable ----------
  console.log('T7  the panel and the figures drive the map');
  p = await mount({ hydrants: HYD, index: IDX });
  await p.click('#dashZones .zrow[data-z="C"]');
  check('a zone row reports its zone', await p.evaluate(() => window.__events), [['zone', 'C']]);
  await p.click('.dstat[data-f="none"]');
  check('a figure reports its status',
    await p.evaluate(() => window.__events[window.__events.length - 1]), ['status', 'none']);
  /* Donut clicks are delegated, because the paths are replaced on every
   * animation frame — per-element listeners would bind only the first render.
   *
   * Dispatched rather than really clicked, and the reason is geometry, not CSS.
   * A donut arc's BOUNDING BOX centre lies outside the arc — in the hole, or on
   * a neighbouring slice — so Playwright's click point never lands on the path
   * it was aimed at. That is inherent to a ring and no styling fixes it.
   *
   * An earlier version of this comment blamed the missing dashboard CSS. That
   * WAS true then and is not now: `.leadline{pointer-events:none}` is ported,
   * and it is asserted directly in tests/v2-dashboard-css.js against V1's
   * computed value. So the guarantee is not lost by dispatching here — it is
   * simply checked in the suite that can check it properly, while this one
   * checks what it is actually for: that the click is DELEGATED, because the
   * paths are replaced on every animation frame. */
  await p.$eval('#dashDonut .seg3d[data-key="none"]',
    (n) => n.dispatchEvent(new MouseEvent('click', { bubbles: true })));
  check('a donut segment reports its status (delegated)',
    await p.evaluate(() => window.__events[window.__events.length - 1]), ['status', 'none']);
  await p.close();

  // ---------- T8: the phone ----------
  console.log('T8  no sideways scroll on a phone');
  for (const w of [360, 390, 430]) {
    p = await mount({ hydrants: HYD, index: IDX }, { width: w, height: 780 });
    check(w + 'px · no horizontal overflow',
      await p.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), true);
    await p.close();
  }

  await b.close(); server.close();
  console.log('\n' + pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})();
