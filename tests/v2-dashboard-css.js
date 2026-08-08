/* Phase 2 gate, part 4 — see docs/V2-ROADMAP.md.
 *
 * The dashboard stylesheet is a verbatim copy of V1's #dashView block. "Verbatim"
 * is easy to claim and easy to get subtly wrong: a missed rule, a missing custom
 * property, a selector that no longer matches because a component emitted
 * slightly different markup. None of those throw. They just render differently,
 * and on a phone in sunlight "differently" can mean unreadable.
 *
 * So this does not diff the CSS text. It boots V1's real dashboard and the V2
 * harness in the same browser and compares getComputedStyle on the properties
 * that carry MEANING rather than decoration:
 *
 *   - .leadline pointer-events, which is why a leader line does not swallow a
 *     click meant for the ring
 *   - the three status inks and their glows, which are measured for contrast
 *     against the card base (CLAUDE.md §3)
 *   - the donut centre type, the stat card metrics, the grid at both sides of
 *     the 980px breakpoint
 *   - no horizontal overflow at 360 / 390 / 430px (§4.9)
 *
 * Run:  node tests/v2-dashboard-css.js
 */
const fs = require('fs');
const os = require('os');
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

// V1, with the login gate out of the way and the dashboard tab showing.
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'epb-css-'));
const APP = path.join(TMP, 'app.html');
fs.writeFileSync(APP, fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8')
  .replace('function isAdmin(){ return IS_ADMIN === true; }', 'function isAdmin(){ return true; }'));

/* The properties worth comparing, as [selector, property]. Chosen because each
 * one is either a documented decision or a defect that has already happened —
 * not because it is easy to read. */
const PROBES = [
  ['#dashView .leadline', 'pointer-events'],   // a leader line must not eat a click
  ['#dashView .leaddot', 'pointer-events'],
  ['#dashView .labg.k-ok .pc3', 'fill'],       // measured contrast, §3
  ['#dashView .labg.k-wait .pc3', 'fill'],
  ['#dashView .labg.k-none .pc3', 'fill'],
  ['#dashView .labg.k-ok .pc3', 'filter'],     // the subtle glow, drop-shadow not text-shadow
  ['#dashView .pc3', 'font-size'],
  ['#dashView .pc3', 'font-weight'],
  ['#dashView .nm3', 'font-size'],
  ['#dashView .center-n', 'font-size'],
  ['#dashView .center-n', 'fill'],
  ['#dashView .center-l', 'letter-spacing'],
  ['#dashView .dstat', 'padding-top'],
  ['#dashView .dstat', 'border-radius'],
  ['#dashView .dstats', 'gap'],
  ['#dashView .dcard', 'background-color'],
  ['#dashView .dcard', 'border-radius'],
  ['#dashView h2', 'letter-spacing'],
  ['#dashView h2', 'text-transform'],
  ['#dashView .dwrap', 'max-width'],
  ['#dashView .dtwrap', 'overflow-x'],         // §4.9 — the table scrolls, not the page
  ['#dashView .zrow', 'display'],
  ['#dashView .znote', 'font-size'],
  ['#dashView .dmono', 'font-family'],
];

// Read a property off a temporary element carrying the selector's classes, so
// a rule can be probed even when no such element is on screen right now.
const READ = (probes) => {
  const out = {};
  probes.forEach(([sel, prop]) => {
    // Build a matching element chain from the selector: "#dashView .a.b .c"
    const parts = sel.split(' ').filter(Boolean);
    const root = document.getElementById('dashView');
    if (!root) { out[sel + '|' + prop] = 'NO #dashView'; return; }
    let host = root, made = [];
    for (let i = 1; i < parts.length; i++) {
      const tag = /zrow|dstat|dedit|ddel/.test(parts[i]) ? 'button'
                : /pc3|nm3|center-/.test(parts[i]) ? 'text'
                : /leadline/.test(parts[i]) ? 'path'
                : /leaddot/.test(parts[i]) ? 'circle'
                : parts[i] === 'h2' ? 'h2' : 'div';
      const isSvg = ['text', 'path', 'circle'].includes(tag);
      const el = isSvg ? document.createElementNS('http://www.w3.org/2000/svg', tag)
                       : document.createElement(tag);
      parts[i].split('.').filter(Boolean).forEach((c) => { if (c !== 'h2') el.classList.add(c); });
      // an <svg> wrapper is needed for SVG children to compute styles
      if (isSvg && host.tagName !== 'svg') {
        const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
        host.appendChild(svg); made.push(svg); host = svg;
      }
      host.appendChild(el); made.push(el); host = el;
    }
    out[sel + '|' + prop] = getComputedStyle(host).getPropertyValue(prop).trim();
    made.reverse().forEach((n) => n.remove());
  });
  return out;
};

(async () => {
  execFileSync('npx', ['vite', 'build'], { cwd: ROOT, stdio: 'pipe', env: { ...process.env, V2_HARNESS: '1' } });

  /* THE STYLESHEET MUST BALANCE.
   *
   * An unbalanced stylesheet does not fail and does not warn: a missing `}`
   * makes the parser NEST everything after it inside the unclosed block, so
   * those rules simply stop applying. It happened here — a transcription cut
   * `.cards .card` in half, map.css came out one `}` short, and because
   * main.js imports dashboard.css AFTER map.css the entire dashboard silently
   * lost its styling while every build stayed green and the app still
   * rendered.
   *
   * Checked on the BUILT file, because that is what the browser parses and it
   * is the concatenation of all four stylesheets — the place where one file's
   * missing brace becomes another file's problem. Counting braces in the
   * sources is not equivalent and gives false positives: `{` and `}` appear
   * inside comments and in @keyframes prose. */
  const cssFile = fs.readdirSync(path.join(DIST, 'assets')).find((f) => f.endsWith('.css'));
  check('exactly one stylesheet is emitted (cssCodeSplit:false)', !!cssFile, true);
  const cssText = fs.readFileSync(path.join(DIST, 'assets', cssFile), 'utf8');
  let depth = 0, wentNegative = false;
  for (const ch of cssText) {
    if (ch === '{') depth++;
    else if (ch === '}') { depth--; if (depth < 0) wentNegative = true; }
  }
  check('the built stylesheet has balanced braces', [depth, wentNegative], [0, false]);
  // A rule from the LAST stylesheet in the import chain: if anything earlier
  // swallowed it, this is what goes missing first.
  check('dashboard rules survived the concatenation',
    /#dashView[^{}]*\.dcard[^{}]*\{/.test(cssText), true);

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

  // ---- V1 ----
  const p1 = await b.newPage({ viewport: { width: 1280, height: 950 } });
  await p1.addInitScript(() => {
    const noop = () => {};
    const layer = () => ({ addTo() { return this; }, clearLayers() {}, addLayer() {} });
    window.L = { map: () => ({ on: noop, invalidateSize: noop, fitBounds: noop, setView: noop }),
      control: { zoom: () => ({ addTo: noop }) }, tileLayer: () => ({ addTo: noop }),
      layerGroup: layer, markerClusterGroup: layer, divIcon: (o) => o, latLngBounds: (a) => a,
      marker: () => ({ bindTooltip() { return this; }, on() { return this; } }) };
  });
  await p1.goto('file://' + APP);
  await p1.waitForTimeout(1200);
  await p1.evaluate(() => { document.getElementById('authGate').classList.add('hide');
                            document.getElementById('dashView').classList.remove('hide'); });
  const v1 = await p1.evaluate(READ, PROBES);

  // ---- V2 ----
  const p2 = await b.newPage({ viewport: { width: 1280, height: 950 } });
  p2.on('pageerror', (e) => { console.log('  PAGEERROR', e.message); fail++; });
  await p2.addInitScript(() => { window.__fixture = { hydrants: [{ id: 1, label: 'A01', status: 'kerajaan' }], index: {} }; });
  await p2.goto(base, { waitUntil: 'load' });
  await p2.waitForTimeout(300);
  const v2 = await p2.evaluate(READ, PROBES);

  PROBES.forEach(([sel, prop]) => {
    const k = sel + '|' + prop;
    check(sel + ' { ' + prop + ' }', v2[k], v1[k]);
  });

  // The grid is the one rule with a breakpoint, and it is what keeps two cards
  // side by side on a laptop and stacked on a phone.
  for (const w of [1280, 900]) {
    await p1.setViewportSize({ width: w, height: 900 });
    await p2.setViewportSize({ width: w, height: 900 });
    await p1.waitForTimeout(120); await p2.waitForTimeout(120);
    const g1 = await p1.evaluate(() => getComputedStyle(document.querySelector('#dashView .dgrid')).gridTemplateColumns.split(' ').length);
    const g2 = await p2.evaluate(() => getComputedStyle(document.querySelector('#dashView .dgrid')).gridTemplateColumns.split(' ').length);
    check(w + 'px · .dgrid column count matches V1', g2, g1);
  }
  await p1.close();

  // §4.9 — a 5-column table must scroll inside .dtwrap, never push the page.
  for (const w of [360, 390, 430]) {
    await p2.setViewportSize({ width: w, height: 800 });
    await p2.waitForTimeout(150);
    check(w + 'px · no horizontal overflow',
      await p2.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), true);
  }

  await p2.close();
  await b.close(); server.close();
  console.log('\n' + pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})();
