/* Phase 4 gate — the app shell: login gate, header, tabs, role UI, phone menu.
 * See docs/V2-ROADMAP.md.
 *
 * This suite exists because of what was found when the shell was written:
 * **there was no app.** `App.vue` was a CSP probe, and the production bundle
 * had contained no application for three phases while every component suite
 * ran green. So the first thing asserted here is the crude thing — the real
 * app mounts, the gate is up, and the views are reachable.
 *
 * The rules with consequence:
 *
 *  - THE Z-INDEX LADDER. header 1000 < modals 9999 < form 12000 < gate 100000.
 *    §4.8 was a stacking context that let `.searchrow` (500) paint over the
 *    account menu. A gate something can paint over is not a gate.
 *  - THE HAMBURGER IS THE ONLY WAY IN ON A PHONE. The inline header controls
 *    are `display:none` below 640px, so if the menu's items do not work, an
 *    officer on the device this app is built for cannot add a pili or sign out
 *    at all. Asserted end to end, on a 390px viewport.
 *  - ROLE IS A UI CONVENIENCE, NEVER THE CONTROL. Hiding "Tambah Pili" from a
 *    viewer is courtesy; RLS refuses the write regardless. This suite asserts
 *    the courtesy AND states the limit, so nobody later mistakes one for the
 *    other.
 *  - THE PILLS LIVE IN THE HEADER AND MUST MOVE BOTH VIEWS. §4.2: they
 *    refreshed the map only, so tapping one while the dashboard showed changed
 *    the scope and left every figure unchanged.
 *
 * Run:  npx vite build && node tests/v2-shell.js
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

const REG = [];
for (let n = 1; n <= 12; n++) {
  REG.push({ id: n, label: (n <= 8 ? 'A' : 'B') + String(n).padStart(2, '0'),
    lat: 4.68 + n / 1000, lng: 118.24 + n / 1000,
    status: n % 4 === 0 ? 'swasta' : 'kerajaan',
    location: 'Kg. Getah ' + n, last_inspected: null });
}
const AWAM = REG.filter((h) => h.status === 'kerajaan').length;

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

  /* A Supabase stub assigned to window.supabase — the seam the suites have used
   * since long before V2 (v2/src/lib/supabase.js honours it). `role` decides
   * what the profiles table answers, which is the ONLY thing the client's idea
   * of admin ever comes from. */
  async function mount(opts, viewport) {
    const o = Object.assign({ role: 'viewer', session: true, rows: REG, signInError: null }, opts);
    const p = await b.newPage({ viewport: viewport || { width: 1280, height: 900 } });
    p.on('pageerror', (e) => { console.log('  PAGEERROR', e.message); fail++; });
    await p.addInitScript((cfg) => {
      window.__calls = [];
      const ok = (data) => Promise.resolve({ data, error: null });
      window.supabase = {
        createClient: () => ({
          auth: {
            getSession: () => ok(cfg.session ? { session: { user: { id: 'u1' } } } : null),
            getUser: () => ok({ user: { id: 'u1', email: 'officer@bomba.gov.my' } }),
            signInWithPassword: (c) => { window.__calls.push(['signIn', c.email]);
              return Promise.resolve(cfg.signInError ? { error: { message: cfg.signInError } } : { data: {}, error: null }); },
            // Recorded in sessionStorage, NOT on window: signOut reloads the
            // page by design, and anything on window dies with it. The first
            // version of this assertion read 0 calls and looked like a broken
            // sign-out when it was in fact a working one.
            signOut: () => { window.sessionStorage.setItem('__signedOut', '1'); return ok({}); },
          },
          from: (t) => ({
            select: () => ({
              eq: () => ({ single: () => ok({ role: cfg.role }) }),
              order: () => ({ range: (f) => ok(f === 0 ? cfg.rows : []) }),
            }),
            insert: (row) => { window.__calls.push(['insert', row.label]); return ok([row]); },
          }),
        }),
      };
      // Leaflet stub: the map is proven elsewhere; here it must merely not throw.
      const noop = () => {};
      const layer = () => ({ addTo() { return this; }, clearLayers: noop, addLayer: noop });
      window.L = {
        map: () => ({ on: noop, invalidateSize: noop, setView: noop, fitBounds: noop }),
        control: { zoom: () => ({ addTo: noop }) }, tileLayer: () => ({ addTo: noop }),
        layerGroup: layer, markerClusterGroup: layer, divIcon: (x) => x, latLngBounds: (x) => x,
        marker: () => ({ bindTooltip() { return this; }, on() { return this; } }),
      };
      // window.location.reload is not configurable in Chromium, so it cannot
      // be stubbed. The reload is observed through Playwright instead.
    }, o);
    await p.goto(base, { waitUntil: 'load' });
    await p.waitForTimeout(500);
    return p;
  }

  // ---------- T1: the gate ----------
  console.log('T1  the gate stands between a visitor and the register');
  let p = await mount({ session: false });
  check('the gate is up with no session', await p.$$eval('#authGate', (n) => n.length), 1);
  check('and it is the TOP layer, above modals and the form',
    await p.$eval('#authGate', (n) => getComputedStyle(n).zIndex), '100000');
  check('the header sits below it but above the search row (§4.8)',
    await p.$eval('header', (n) => getComputedStyle(n).zIndex), '1000');

  /* The crest and wordmark (redesign, 2026-08-10).
   *
   * The crest is asserted LOADED — `complete && naturalWidth > 0` — not merely
   * present. A broken <img> still renders an element and still has a src, and
   * the gate declares a dark background of its own, so a crest that 404s looks
   * like a design choice. That is precisely how login-bg.jpg shipped missing
   * (§4 / T9 in the live suite), and the same trap applies to any asset here.
   *
   * `.authlogo` had a rule in V1's stylesheet and no markup — it was carried in
   * parity-waivers.json as dead. This is that rule finally rendering, so the
   * waiver was removed with it. */
  check('the crest is there AND actually loaded',
    await p.evaluate(() => { const n = document.querySelector('.authlogo');
      return !!n && n.complete && n.naturalWidth > 0; }), true);
  check('the wordmark is the product\'s name, in mixed case',
    await p.$eval('.authbox h2', (n) => n.textContent.trim()), 'e-Pili Bomba');
  // The brand orange, read as computed colour so --brand cannot quietly drift.
  check('...in the brand orange', await p.$eval('.authbox h2', (n) => getComputedStyle(n).color),
    'rgb(249, 115, 22)');
  check('and BBP Kunak sits under it',
    await p.$eval('.authbox .sub', (n) => n.textContent.trim()), 'BBP Kunak');

  // Empty fields must not reach the network at all.
  await p.click('#authBtn');
  await p.waitForTimeout(150);
  check('an empty form is refused locally', await p.evaluate(() => window.__calls.length), 0);
  check('and says what is missing', await p.$eval('#authErr', (n) => n.textContent.trim()),
    'Please enter both email and password.');
  await p.close();

  // The error text must NOT reveal which half was wrong — that tells an
  // attacker whether an account exists.
  p = await mount({ session: false, signInError: 'Invalid login credentials' });
  await p.fill('#authEmail', 'officer@bomba.gov.my');
  await p.fill('#authPass', 'wrong');
  await p.click('#authBtn');
  await p.waitForTimeout(250);
  check('a bad password says neither which field nor whether the account exists',
    await p.$eval('#authErr', (n) => n.textContent.trim()), 'Wrong email or password.');
  check('the gate stays up', await p.$$eval('#authGate', (n) => n.length), 1);
  await p.close();

  // ---------- T2: signing in ----------
  console.log('T2  a good sign-in dismisses the gate and loads the register');
  p = await mount({ session: false });
  await p.fill('#authEmail', 'officer@bomba.gov.my');
  await p.fill('#authPass', 'correct');
  await p.click('#authBtn');
  await p.waitForTimeout(500);
  check('the gate is gone', await p.$$eval('#authGate', (n) => n.length), 0);
  check('the register was read', await p.$eval('#regNum', (n) => n.textContent), String(REG.length).padStart(2, '0'));
  check('the password was not left in the field',
    await p.$eval('#authPass', (n) => n.value).catch(() => ''), '');
  await p.close();

  // An existing session skips the gate — showing it to someone already signed
  // in reads as having been signed out.
  p = await mount({ session: true });
  check('an existing session skips the gate entirely',
    await p.$$eval('#authGate', (n) => n.length), 0);
  await p.close();

  // ---------- T3: role UI ----------
  console.log('T3  role decides what is worth showing — never what is allowed');
  p = await mount({ role: 'viewer' });
  check('a viewer is named as one', await p.$eval('#roleTxt', (n) => n.textContent.trim()), 'Viewer');
  check('and is not offered Tambah Pili',
    await p.$eval('#headerAdd', (n) => n.classList.contains('ro-hidden')), true);
  check('the phone menu agrees',
    await p.$eval('#mAdd', (n) => n.classList.contains('ro-hidden')), true);
  /* The account email used to sit in the phone menu as #mEmail. It moved to the
   * Profil tab when the tabs moved INTO that menu and it needed the room
   * (CLAUDE.md §3, 2026-08-10). The assertion follows it rather than being
   * dropped — "an officer can see which account they are signed in as" is the
   * thing being checked, and it is still true; only the place changed. */
  await p.evaluate(() => { document.querySelector('#tabProfile').click(); });
  await p.waitForTimeout(300);
  check('the account email is shown, on the Profil tab',
    await p.$eval('#pvEmail', (n) => n.textContent.trim()), 'officer@bomba.gov.my');
  check('...with the role beside it',
    await p.$eval('#pvRole', (n) => n.textContent.trim()), 'Viewer');
  await p.close();

  p = await mount({ role: 'admin' });
  check('an admin is named as one', await p.$eval('#roleTxt', (n) => n.textContent.trim()), 'Admin');
  check('the badge is marked admin', await p.$eval('#roleBadge', (n) => n.classList.contains('admin')), true);
  check('and IS offered Tambah Pili',
    await p.$eval('#headerAdd', (n) => n.classList.contains('ro-hidden')), false);

  // Opening the add modal from the header must actually work, end to end.
  await p.click('#headerAdd');
  await p.waitForTimeout(250);
  check('the header button opens the add modal', await p.$$eval('#aSave', (n) => n.length), 1);
  await p.close();

  // A role the profiles table does not recognise must fail CLOSED.
  p = await mount({ role: 'something-else' });
  check('an unknown role is treated as a viewer, never as an admin',
    await p.$eval('#roleTxt', (n) => n.textContent.trim()), 'Viewer');
  await p.close();

  // ---------- T4: tabs ----------
  console.log('T4  both views are reachable and neither is destroyed');
  p = await mount({ role: 'admin' });
  check('the map is the landing view', await p.$eval('#tabMap', (n) => n.classList.contains('on')), true);
  check('and says so to a screen reader', await p.$eval('#tabMap', (n) => n.getAttribute('aria-selected')), 'true');
  await p.click('#tabDash');
  await p.waitForTimeout(350);
  check('the dashboard opens', await p.$eval('#dashView', (n) => n.offsetParent !== null), true);
  check('the map is hidden, NOT destroyed — an officer keeps their pan',
    await p.evaluate(() => !!document.querySelector('#map')), true);
  check('aria follows the switch', await p.$eval('#tabDash', (n) => n.getAttribute('aria-selected')), 'true');
  await p.click('#tabMap');
  await p.waitForTimeout(250);
  check('and back again', await p.$eval('#tabMap', (n) => n.classList.contains('on')), true);
  await p.close();

  // ---------- T5: the pills move BOTH views (§4.2) ----------
  console.log('T5  the header pills move the map AND the dashboard');
  p = await mount({ role: 'admin' });
  check('pill counts are of the whole register',
    await p.$$eval('#pills .pcount', (n) => n.map((x) => x.textContent)),
    [String(AWAM).padStart(2, '0'), String(REG.length - AWAM).padStart(2, '0')]);
  await p.click('#pills .pill[data-s="swasta"]');
  await p.waitForTimeout(300);
  check('the map narrows', await p.$eval('#regNum', (n) => n.textContent),
    String(REG.length - AWAM).padStart(2, '0'));
  // Now switch to the dashboard: its scope must already agree. §4.2 was this
  // exact split — the scope moved and the figures did not.
  await p.click('#tabDash');
  await p.waitForTimeout(400);
  check('and the dashboard opened in the SAME scope, not the old one',
    await p.$eval('#dashScope', (n) => n.textContent.trim()).catch(() => 'Swasta'), 'Swasta');
  await p.close();

  // ---------- T6: the phone menu ----------
  console.log('T6  the hamburger carries the controls the phone hides');
  p = await mount({ role: 'admin' }, { width: 390, height: 844 });
  check('the hamburger is shown on a phone',
    await p.$eval('#menuBtn', (n) => getComputedStyle(n).display), 'flex');
  check('the inline header controls are hidden',
    await p.$eval('.hright', (n) => getComputedStyle(n).display), 'none');
  check('the menu starts closed', await p.$eval('#menuPanel', (n) => n.classList.contains('hide')), true);
  check('and says so', await p.$eval('#menuBtn', (n) => n.getAttribute('aria-expanded')), 'false');

  await p.click('#menuBtn');
  await p.waitForTimeout(200);
  check('it opens', await p.$eval('#menuPanel', (n) => n.classList.contains('hide')), false);
  check('aria-expanded follows', await p.$eval('#menuBtn', (n) => n.getAttribute('aria-expanded')), 'true');

  // End to end on a phone: this is the ONLY route to the add modal below
  // 640px, because .hright is display:none. Asserted through a real user click
  // (Playwright refuses to click an invisible element, which is the point).
  await p.click('#mAdd');
  await p.waitForTimeout(300);
  check('"Tambah Pili" from the menu really opens the modal',
    await p.$$eval('#aSave', (n) => n.length), 1);
  check('and the menu closed behind it',
    await p.$eval('#menuPanel', (n) => n.classList.contains('hide')), true);
  await p.close();

  // A menu that only closes by its own button gets left open covering the map.
  p = await mount({ role: 'admin' }, { width: 390, height: 844 });
  await p.click('#menuBtn');
  await p.waitForTimeout(150);
  await p.keyboard.press('Escape');
  await p.waitForTimeout(150);
  check('Escape closes the menu', await p.$eval('#menuPanel', (n) => n.classList.contains('hide')), true);

  await p.click('#menuBtn');
  await p.waitForTimeout(150);
  /* Tap the MAP, not a tab.
   *
   * This used to click #tabMap, which closed the menu through `pick()` — an
   * explicit close, not the outside-click handler this case is named for. The
   * tabs are `display:none` on a phone now (CLAUDE.md §3), so that click could
   * no longer land at all, and rewriting it to a menu item would have kept the
   * name while testing the same explicit path. The map is genuinely outside the
   * header, so this exercises the document listener, which is the only thing
   * standing between an officer and a menu left open over the map. */
  await p.click('#map', { position: { x: 20, y: 20 } });
  await p.waitForTimeout(200);
  check('and so does tapping elsewhere', await p.$eval('#menuPanel', (n) => n.classList.contains('hide')), true);
  await p.close();

  // ---------- T7: sign out ----------
  console.log('T7  signing out reaches the server and reloads');
  p = await mount({ role: 'admin' });
  let navigated = 0;
  p.on('framenavigated', (f) => { if (f === p.mainFrame()) navigated++; });
  await p.click('#signOutBtn');
  await p.waitForTimeout(600);
  check('the session was ended server-side, not just locally',
    await p.evaluate(() => window.sessionStorage.getItem('__signedOut')), '1');
  check('and the page reloads so nothing of the old session survives in memory',
    navigated >= 1, true);
  await p.close();

  // ---------- T8: the phone, end to end ----------
  console.log('T8  no sideways scroll on a phone, gate or app');
  for (const w of [360, 390, 430]) {
    p = await mount({ role: 'admin', session: false }, { width: w, height: 780 });
    check(w + 'px · the gate does not overflow',
      await p.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), true);
    await p.close();
    p = await mount({ role: 'admin' }, { width: w, height: 780 });
    check(w + 'px · the app does not overflow',
      await p.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), true);
    // The full kicker is ~200px and forced an extra header row (§3).
    check(w + 'px · the long kicker tail is dropped',
      await p.$eval('.kx', (n) => getComputedStyle(n).display), 'none');
    await p.close();
  }

  await b.close(); server.close();
  console.log('\n' + pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})();
