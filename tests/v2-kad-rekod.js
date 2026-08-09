/* Phase 5 gate — KAD REKOD PILI BOMBA in V2.
 *
 * docs/KAD-REKOD.md is BINDING. This is a mandatory record under MS ISO
 * 9001:2015 procedure PS-8, and it is the one view in this app whose failures
 * are INVISIBLE ON SCREEN — they surface on paper, at the officer who files
 * the card. Three print defects have shipped here, and every one was found by
 * a human holding a printout.
 *
 * So this suite does the thing no other suite in the repo does: **it renders
 * the card to PDF and counts the pages.** One Kad Rekod is exactly two pages,
 * never one, never three. A row height, a font size or a capacity changed by a
 * few percent silently pushes it onto a third sheet, and nothing on a screen
 * will ever say so.
 *
 * It also guards the two rules that are backwards from each other on purpose:
 * the screen shows the NEWEST card first, paper shows the OLDEST first. That
 * is one CSS line (`.fsheet{flex-direction:column-reverse}`) over a
 * deliberately CHRONOLOGICAL render loop. Reversing the loop instead would
 * reverse the paper too and break the page breaks — invisibly.
 *
 * WHAT THIS SUITE IS NOT. It is not a substitute for printing a card. Every
 * print-facing property here was measurable and still reached paper wrong at
 * least once. docs/KAD-REKOD.md requires a real printout before anything
 * touching this card ships, and that requirement stands whatever this reports.
 *
 * Run:  V2_HARNESS=1 npx vite build && node tests/v2-kad-rekod.js
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

// The capacities are the specification, not a preference (docs/KAD-REKOD.md §1).
const PER = { kerosakan: 11, pemantauan: 11, pengujian: 15, kompaun: 10 };
const HY = { id: 26, label: 'C26', status: 'kerajaan', location: 'Kg. Madai' };

// Build a form with `cards` full cards' worth of rows, every row filled, so the
// PDF is the WORST case for height — an empty card would fit on anything.
function makeForm(cards, opts) {
  const o = opts || {};
  const f = { header: { lokasi: 'Kg. Madai', tarikh_pasang: '2019-04-02', no_keahlian: 'K-114', tarikh_daftar: '2019' } };
  const fill = {
    kerosakan: { tarikh: '2026-01-0', jenis: 'Bocor pada injap', cadangan: 'Ganti gasket', mula: '2026-01-05', siap: '2026-01-06', kos: 'RM120', syarikat: 'JBPM Kunak' },
    pemantauan: { tarikh: '2026-02-0', kebersihan: 'Baik', fizikal: 'Baik' },
    pengujian: { tarikh: '2026-03-0', penguji: 'Ismail', statik: '4.2', semasa: '3.8', gpm: '750', catatan: 'Normal' },
    kompaun: { tarikh: '2026-04-0', jenis: 'Halangan', tindakan: 'Notis', no_kompaun: 'KP-1', amaun: 'RM300' },
  };
  Object.keys(PER).forEach((sec) => {
    f[sec] = [];
    for (let c = 0; c < cards; c++) {
      for (let i = 0; i < PER[sec]; i++) {
        const row = Object.assign({}, fill[sec]);
        Object.keys(row).forEach((k) => { if (k === 'tarikh') row[k] = row[k] + ((i % 9) + 1); });
        row.tt = '';
        if (o.signRow && o.signRow.section === sec && o.signRow.card === c && o.signRow.row === i) {
          row._signed = true; row._sig = 'sig/26.png';
          if (o.signRow.url) row._sigUrl = o.signRow.url;
        }
        f[sec].push(row);
      }
    }
  });
  return f;
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
    await p.addInitScript((f) => { window.__fixture = Object.assign({ view: 'kad' }, f); }, fixture);
    await p.goto(base, { waitUntil: 'load' });
    await p.waitForTimeout(400);
    return p;
  }

  // ---------- T1: structure ----------
  console.log('T1  one card is exactly two pages, in the specified order');
  let p = await mount({ hydrant: HY, form: makeForm(1), isAdmin: true });
  check('one card', await p.$$eval('.fcard', (n) => n.length), 1);
  check('...made of exactly two pages', await p.$$eval('.fcard .fpage', (n) => n.length), 2);
  check('page 1 carries the header block', await p.$$eval('.fcard .fpage:nth-child(1) .fhdr', (n) => n.length), 1);
  check('page 1 holds Kerosakan then Pemantauan',
    await p.$$eval('.fcard .fpage:nth-child(1) table.ftab', (n) => n.map((t) => t.className.replace('ftab ', ''))),
    ['kerosakan', 'pemantauan']);
  check('page 2 holds Pengujian then Kompaun',
    await p.$$eval('.fcard .fpage:nth-child(2) table.ftab', (n) => n.map((t) => t.className.replace('ftab ', ''))),
    ['pengujian', 'kompaun']);
  check('page 2 always breaks to a new sheet',
    await p.$eval('.fcard .fpage:nth-child(2)', (n) => n.classList.contains('pb')), true);

  /* Section titles and column headings.
   *
   * Every one of these was MISSING from V2 and nothing noticed: KadRekod.vue
   * renders `SECTIONS[sec].title` and `v-html="SECTIONS[sec].thead"`, and
   * records-logic.js carried neither, so the card drew blank yellow section
   * bars over unlabelled columns. On a controlled record under MS ISO, a table
   * of dates and pressures with no headings is not a record.
   *
   * This suite already asserted the card's SHAPE — two pages, the section
   * order, the row capacities — which is why it stayed green: every structural
   * assertion passes just as well over an unlabelled table. Shape is not
   * content. */
  const TITLES = {
    kerosakan: 'REKOD PENYELENGGARAAN/BAIK PULIH KEROSAKAN',
    pemantauan: 'REKOD PEMANTAUAN TEMAN PILI BOMBA',
    pengujian: 'REKOD PENYELENGGARAAN/PENGUJIAN PILI BOMBA',
    kompaun: 'REKOD KOMPAUN',
  };
  check('all four section titles are printed, in order',
    await p.$$eval('.fcard .fsec-title', (n) => n.map((x) => x.textContent.trim())),
    ['kerosakan', 'pemantauan', 'pengujian', 'kompaun'].map((k) => TITLES[k]));

  // One representative heading per section, and the merged-header structure
  // that carries the sub-columns (Mula/Siap, Kebersihan/Fizikal, Statik/Semasa).
  for (const [sec, want] of Object.entries({
    kerosakan: ['Tarikh', 'Jenis Kerosakan', 'Cadangan Baik Pulih', 'Mula', 'Siap', 'Kos', 'Syarikat', 'T.T'],
    pemantauan: ['Tarikh', 'Status', 'Kebersihan', 'Fizikal', 'T.T'],
    pengujian: ['Tarikh', 'Tekanan', 'Statik', 'Semasa', 'Catatan', 'T.T'],
    kompaun: ['Tarikh', 'Masa', 'Seksyen', 'No. Tawaran'],
  })) {
    const got = await p.$$eval('table.ftab.' + sec + ' thead th', (n) => n.map((x) => x.textContent.trim()));
    check(sec + ' carries its column headings', want.every((w) => got.includes(w)), true);
  }
  // The two-row header is structural: "Tarikh" spanning Mula/Siap, "Tekanan"
  // spanning Statik/Semasa. A flat header would satisfy the text check above.
  check('pengujian has a two-row header with a spanning cell',
    await p.$$eval('table.ftab.pengujian thead tr', (n) => n.length), 2);
  check('...and Tekanan spans its two sub-columns',
    await p.$eval('table.ftab.pengujian thead th[colspan="2"]', (n) => n.textContent.trim()), 'Tekanan');

  // The capacities ARE the spec. A row lost here is a row an officer cannot write.
  for (const sec of Object.keys(PER)) {
    check(sec + ' holds exactly ' + PER[sec] + ' rows per card',
      await p.$$eval('table.ftab.' + sec + ' tbody tr', (n) => n.length), PER[sec]);
  }
  await p.close();

  // ---------- T2: numbering, and the screen/paper split ----------
  console.log('T2  numbers are permanent and chronological; screen and paper differ');
  p = await mount({ hydrant: HY, form: makeForm(3), isAdmin: true });
  check('three cards', await p.$$eval('.fcard', (n) => n.length), 3);
  check('six pages in total', await p.$$eval('.fpage', (n) => n.length), 6);
  // DOM order is chronological — this is what the printer gets.
  check('the DOM numbers them oldest-first, 1/3 2/3 3/3',
    await p.$$eval('.kadno', (n) => n.map((x) => x.textContent.trim())),
    ['Kad 1/3', 'Kad 2/3', 'Kad 3/3']);
  check('exactly one card is marked TERKINI', await p.$$eval('.terkini', (n) => n.length), 1);
  check('...and it is the NEWEST, not the first in the DOM',
    await p.evaluate(() => {
      const cards = [...document.querySelectorAll('.fcard')];
      return cards.findIndex((c) => c.querySelector('.terkini')) === cards.length - 1;
    }), true);
  check('a single card still shows its number, so "no more cards" is visible',
    await (async () => { const q = await mount({ hydrant: HY, form: makeForm(1) });
      const v = await q.$eval('.kadno', (n) => n.textContent.trim()); await q.close(); return v; })(), 'Kad 1/1');

  // THE screen/paper inversion. On screen the newest must be visually on top;
  // in the DOM (and therefore on paper) the oldest is first.
  check('on SCREEN the newest card sits highest', await p.evaluate(() => {
    const cards = [...document.querySelectorAll('.fcard')];
    const first = cards[0].getBoundingClientRect().top;
    const last = cards[cards.length - 1].getBoundingClientRect().top;
    return last < first;                       // newest (last in DOM) is higher up
  }), true);
  check('...done with column-reverse, not by reversing the render loop',
    await p.$eval('.fsheet', (n) => getComputedStyle(n).flexDirection), 'column-reverse');
  await p.close();

  // ---------- T3: THE PDF PAGE COUNT ----------
  console.log('T3  rendered to PDF and page-counted — the gate the screen cannot give');
  for (const cards of [1, 2, 3]) {
    p = await mount({ hydrant: HY, form: makeForm(cards), isAdmin: true });
    const pdf = await p.pdf({ format: 'Letter', printBackground: true, margin: { top: '8mm', bottom: '8mm', left: '8mm', right: '8mm' } });
    // Count page objects in the PDF itself rather than trusting a CSS rule.
    const n = (pdf.toString('latin1').match(/\/Type\s*\/Page[^s]/g) || []).length;
    check(cards + ' card(s) → exactly ' + (cards * 2) + ' printed pages', n, cards * 2);
    await p.close();
  }

  // Print restores chronological order. Asserted through the computed style in
  // the print media state, because the paper is what the record is.
  p = await mount({ hydrant: HY, form: makeForm(2), isAdmin: true });
  await p.emulateMedia({ media: 'print' });
  await p.waitForTimeout(150);
  check('in PRINT the sheet reads oldest-first again',
    await p.$eval('.fsheet', (n) => getComputedStyle(n).flexDirection), 'column');
  check('TERKINI is a screen affordance and is hidden on paper',
    await p.$eval('.terkini', (n) => getComputedStyle(n).display), 'none');
  /* The millimetre row heights are what make a card exactly two pages.
   * Measured as a DIFFERENCE between the two row types rather than against an
   * absolute: a <td>'s computed height includes its 1px border, so comparing it
   * to a bare 8.3mm box is off by about a pixel and says nothing useful. The
   * gap between 8.3mm and 7.5mm is border-independent, and it is the part that
   * would silently vanish if someone "tidied" the heights to one value. */
  const mmGap = await p.evaluate(() => {
    const px = (mm) => { const d = document.createElement('div'); d.style.height = mm; document.body.appendChild(d);
      const v = parseFloat(getComputedStyle(d).height); d.remove(); return v; };
    const td = (sel) => parseFloat(getComputedStyle(document.querySelector(sel)).height);
    return {
      want: +(px('8.3mm') - px('7.5mm')).toFixed(1),
      got: +(td('table.ftab.pengujian tbody td') - td('table.ftab.kerosakan tbody td')).toFixed(1),
    };
  });
  check('Pengujian rows are taller than the rest by exactly 8.3mm - 7.5mm', mmGap.got, mmGap.want);
  await p.emulateMedia({ media: 'screen' });
  await p.close();

  // ---------- T4: a signed row is permanent ----------
  console.log('T4  a signed row cannot be edited — the first of three defences');
  p = await mount({ hydrant: HY, isAdmin: true,
    form: makeForm(1, { signRow: { section: 'pengujian', card: 0, row: 2, url: 'data:image/png;base64,iVBORw0KGgo=' } }) });
  check('the signed row is marked', await p.$$eval('tr.rowsigned', (n) => n.length), 1);
  check('every input in it is disabled',
    await p.$$eval('tr.rowsigned input', (n) => n.every((i) => i.disabled && i.readOnly)), true);
  check('and it offers no way to attach another signature',
    await p.$$eval('tr.rowsigned .sigbtn', (n) => n.length), 0);
  check('unsigned rows are still editable',
    await p.$$eval('tr:not(.rowsigned) input', (n) => n.length > 0 && n.every((i) => !i.disabled)), true);
  check('an admin CAN sign an unsigned row',
    await p.$$eval('tr:not(.rowsigned) .sigbtn', (n) => n.length > 0), true);
  await p.close();

  // A signed row whose signed link has not resolved yet must show a quiet
  // placeholder — NOT an <img> pointing at the stored path. On a private bucket
  // that is a dead URL, and a broken-image icon on a signed row reads as a lost
  // signature, which is the worst thing this card can appear to say.
  p = await mount({ hydrant: HY, isAdmin: true,
    form: makeForm(1, { signRow: { section: 'pengujian', card: 0, row: 2 } }) });
  check('an unresolved signature shows a placeholder, never a broken image',
    await p.$$eval('tr.rowsigned .sigwait', (n) => n.map((x) => x.textContent.trim())), ['T.T']);
  check('and emits no <img> at all while it is unresolved',
    await p.$$eval('tr.rowsigned img', (n) => n.length), 0);
  await p.close();

  // ---------- T5: Kompaun has no signature column ----------
  console.log('T5  signing is per row, and Kompaun has no T.T at all');
  p = await mount({ hydrant: HY, form: makeForm(1), isAdmin: true });
  check('Kompaun offers no signature control',
    await p.$$eval('table.ftab.kompaun .sigbtn', (n) => n.length), 0);
  for (const sec of ['kerosakan', 'pemantauan', 'pengujian']) {
    check(sec + ' does offer one per row',
      await p.$$eval('table.ftab.' + sec + ' tbody tr .sigbtn', (n) => n.length), PER[sec]);
  }
  check('there is no card-level sign-off anywhere',
    await p.$$eval('.fcard > .sigbtn, .fpage > .sigbtn', (n) => n.length), 0);
  await p.close();

  // ---------- T6: the phone ----------
  console.log('T6  no sideways scroll at 360px');
  for (const w of [360, 390, 430]) {
    p = await mount({ hydrant: HY, form: makeForm(2), isAdmin: true }, { width: w, height: 780 });
    check(w + 'px · no horizontal overflow',
      await p.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), true);
    await p.close();
  }

  await b.close(); server.close();
  console.log('\n' + pass + ' passed, ' + fail + ' failed');
  console.log('\nNOTE: a real printout is still required before this ships — see docs/KAD-REKOD.md §6.');
  process.exit(fail ? 1 : 0);
})();
