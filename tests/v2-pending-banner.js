/* The offline-conflict banner — buildPendingItems() from pending-logic.js.
 *
 * WHY THIS EXISTS. On a three-way offline conflict the cloud wins (§3), and the
 * officer is shown what they typed so they can put it back — V1's
 * renderPendingNotice (index.html:2412-2429). V2 shipped the KadRekod template
 * and the `dropPending` emit but WIRED NEITHER: App.vue passed no `:pending` and
 * built no items, so the banner never rendered in production. The officer's
 * offline typing was parked but invisible — §4.10 wearing a quieter face. This
 * suite guards the builder that closes that gap.
 *
 * THE ESCAPING IS THE POINT. The card renders each string with `v-html`, so an
 * unescaped value would be stored XSS on a legal record. The malicious-value
 * case below is the one that matters: drop esc() and it goes red. A clean
 * fixture would pass on the bug (CLAUDE.md §5 — a fixture that cannot reproduce
 * the defect proves nothing), so a <script> payload is planted deliberately.
 *
 * Pure function, no browser. Run:  node tests/v2-pending-banner.js
 */
let pass = 0, fail = 0;
const check = (name, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  console.log((ok ? '  PASS  ' : '  FAIL  ') + name + (ok ? '' : '\n          got =' + JSON.stringify(got) + '\n          want=' + JSON.stringify(want)));
  ok ? pass++ : fail++;
};
const ok = (name, cond) => check(name, !!cond, true);

(async () => {
  const { buildPendingItems } = await import('../v2/src/stores/pending-logic.js');

  // ---- Empty / nothing-to-show ------------------------------------------------
  check('null rows → no items', buildPendingItems(null), []);
  check('empty rows → no items', buildPendingItems([]), []);
  check('a row with only the tt timestamp and blanks contributes nothing',
    buildPendingItems([{ section: 'pengujian', row_index: 0, data: { tt: '2026-08-18', penguji: '  ' } }]), []);

  // ---- A normal contested data row (byte-for-byte with V1's format) -----------
  const oneData = buildPendingItems([
    { section: 'pengujian', row_index: 2, data: { tt: 'x', penguji: 'AHMAD', bacaan: '7 bar' } },
  ]);
  check('one data row renders one <li>', oneData.length, 1);
  check('data row: section title, 1-based baris, key: <b>value</b>, tt dropped',
    oneData[0],
    '<li>Pengujian · baris 3 — penguji: <b>AHMAD</b> · bacaan: <b>7 bar</b></li>');

  // ---- Header section carries no "· baris N" ---------------------------------
  check('header row omits the baris suffix',
    buildPendingItems([{ section: 'header', row_index: 0, data: { lokasi: 'Jalan Kunak' } }])[0],
    '<li>Maklumat pili — lokasi: <b>Jalan Kunak</b></li>');

  // ---- A removed row says what it WAS ----------------------------------------
  check('removed row: "anda kosongkan baris ini" with the original values',
    buildPendingItems([{ section: 'kerosakan', row_index: 0, removed: true, base: { tt: 'x', jenis: 'bocor' } }])[0],
    '<li>Kerosakan · baris 1 — <b>anda kosongkan baris ini</b> (asal — jenis: <b>bocor</b>)</li>');
  check('removed row with no recoverable base shows no "(asal …)" tail',
    buildPendingItems([{ section: 'kerosakan', row_index: 0, removed: true, base: { tt: 'x' } }])[0],
    '<li>Kerosakan · baris 1 — <b>anda kosongkan baris ini</b></li>');

  // ---- THE ESCAPING CASE — this is what goes red if esc() is removed ----------
  const evil = buildPendingItems([
    { section: 'pengujian', row_index: 0, data: { penguji: '<script>alert(1)</script>', nota: 'a & b "c"' } },
  ])[0];
  ok('the <script> value is escaped, not emitted raw', evil.indexOf('<script>') === -1);
  ok('...it appears as &lt;script&gt; instead', evil.indexOf('&lt;script&gt;alert(1)&lt;/script&gt;') !== -1);
  ok('& is escaped to &amp;', evil.indexOf('a &amp; b') !== -1);
  ok('" is escaped to &quot;', evil.indexOf('&quot;c&quot;') !== -1);
  // The structural <b> tags we emit ourselves must survive — escaping is on the
  // VALUES, not on our own markup.
  ok('our own <b> wrapper is still literal markup', evil.indexOf('<b>') !== -1 && evil.indexOf('</b>') !== -1);

  // A malicious SECTION or KEY name is escaped too (defence in depth — these are
  // schema-controlled today, but V1 escaped them and this transcription does too).
  const evilKey = buildPendingItems([
    { section: 'pengujian', row_index: 0, data: { '<img src=x>': 'v' } },
  ])[0];
  ok('a malicious key is escaped', evilKey.indexOf('<img') === -1 && evilKey.indexOf('&lt;img') !== -1);

  console.log('\n' + pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})();
