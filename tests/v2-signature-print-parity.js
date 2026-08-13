/* THE PRINTED SIGNATURE, V1 vs V2 — byte for byte.
 *
 * This suite exists because the same algorithm is now written TWICE: once in
 * `index.html`, which is the app officers print from today, and once in
 * `v2/src/lib/signature-print.js`, which is the app they will print from after
 * cutover. Two copies of a rule that decides what reaches a legal record is
 * exactly the shape that drifts, and drift here is invisible until paper.
 *
 * It also pins the defect that caused it. A01 printed on 2026-08-13 as a stray
 * diagonal and four dots. Diagnosed from the officer's own PDF: the embedded
 * image was pure black with binary alpha covering 1.48% of its frame, so the
 * print copy was built and was what printed — `signatureForPrint` had thrown
 * the signature away. `SIG_PRINT_CUT` is 0.65 of the image's PEAK alpha and a
 * peak is one pixel; that signature carries near-opaque blobs where the pen
 * pressed and long pale sweeps where it barely touched, so the blobs set the
 * peak at 255, the cutoff landed at 166, and the sweeps fell under it.
 *
 * THE TWO FIXTURES ARE THE TWO ENDS OF ONE DIAL, and this file has shipped
 * each of them once:
 *
 *   - PALE-AND-DARK-TOGETHER erases the signature (§4.31). Guarded by asserting
 *     how much of the VISIBLE ink survives — an officer's own screen is the
 *     reference for what their signature is.
 *   - RESIDUE floods it into a black box (§4.15). Guarded by asserting the
 *     survivors stay a small part of the frame.
 *
 * A fixture carrying only one of them proves nothing about the other, which is
 * how the first fix passed its own tests and reached paper anyway.
 *
 * Run:  node tests/v2-signature-print-parity.js
 */
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');

const ROOT = path.join(__dirname, '..');
const CHROMIUM = process.env.CHROMIUM_PATH || '/opt/pw-browsers/chromium';

let pass = 0, fail = 0;
const check = (name, got, want) => { const ok = JSON.stringify(got) === JSON.stringify(want);
  console.log((ok ? '  PASS  ' : '  FAIL  ') + name + '  got=' + JSON.stringify(got) + (ok ? '' : '  want=' + JSON.stringify(want)));
  ok ? pass++ : fail++; };

/* V1's copy lives inside the page's IIFE and is not reachable from a test, so
 * it is LIFTED OUT OF index.html rather than transcribed here — a copy in this
 * file would make this a test of the copy. Same technique as the donut parity
 * suite, and the same reason. */
function v1Source() {
  const src = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
  const a = src.indexOf('  var SIG_PRINT_CUT = 0.65;');
  const z = src.indexOf('  /* Attach a print copy', a);
  if (a < 0 || z < 0) throw new Error('could not lift signatureForPrint out of index.html');
  return src.slice(a, z);
}
function v2Source() {
  return fs.readFileSync(path.join(ROOT, 'v2/src/lib/signature-print.js'), 'utf8')
    // Only the pure part: addPrintSigs touches the DOM and fetches.
    .split('/* Read an image\'s bytes as a data URL')[0]
    .replace(/^export /gm, '');
}

(async () => {
  const b = await chromium.launch({ executablePath: CHROMIUM });
  const p = await b.newPage();
  p.on('pageerror', (e) => { console.log('  PAGEERROR ' + e.message); fail++; });
  await p.goto('about:blank');

  /* Each copy is wrapped in its own IIFE. Injected bare they would collide —
   * V1 declares `var SIG_PRINT_CUT`, V2 declares `const SIG_PRINT_CUT`, and a
   * const after a var at global scope is a SyntaxError, which would look like
   * the suite itself being broken. */
  await p.addScriptTag({ content: 'window.__v1 = (function(){\n' + v1Source() + '\nreturn signatureForPrint; })();' });
  await p.addScriptTag({ content: 'window.__v2 = (function(){\n' + v2Source() + '\nreturn signatureForPrint; })();' });

  const results = await p.evaluate(async () => {
    /* FIXTURE 1 — A01's shape. One signature holding both extremes: pale
     * sweeps at alpha ~90 and near-opaque blobs at 255. */
    function paleAndDark() {
      const W = 600, H = 444;
      const c = document.createElement('canvas'); c.width = W; c.height = H;
      const x = c.getContext('2d');
      const stroke = (a, lw, pts) => {
        x.globalAlpha = a; x.strokeStyle = '#26364f'; x.lineWidth = lw;
        x.lineCap = 'round'; x.lineJoin = 'round';
        x.beginPath(); x.moveTo(pts[0], pts[1]);
        for (let i = 2; i < pts.length; i += 6) x.bezierCurveTo(pts[i], pts[i + 1], pts[i + 2], pts[i + 3], pts[i + 4], pts[i + 5]);
        x.stroke(); x.globalAlpha = 1;
      };
      stroke(0.35, 5, [20, 420, 180, 380, 380, 300, 560, 190]);
      stroke(0.40, 6, [30, 160, 120, 20, 300, 20, 330, 120]);
      stroke(0.85, 7, [90, 350, 200, 250, 260, 160, 320, 60]);
      x.fillStyle = '#101c2e';
      [[505, 40, 7], [530, 34, 5], [575, 95, 6], [545, 115, 4], [95, 225, 9]]
        .forEach(([cx, cy, r]) => { x.beginPath(); x.arc(cx, cy, r, 0, 7); x.fill(); });
      return c;
    }

    /* FIXTURE 2 — the black-box shape: leftover paper at low-but-non-zero
     * alpha across the WHOLE frame, ink above it. */
    function residue() {
      const W = 600, H = 180;
      const c = document.createElement('canvas'); c.width = W; c.height = H;
      const x = c.getContext('2d');
      const im0 = x.getImageData(0, 0, W, H), d0 = im0.data;
      for (let i = 0; i < d0.length; i += 4) {
        d0[i] = 150; d0[i + 1] = 146; d0[i + 2] = 140; d0[i + 3] = 40 + ((i * 7) % 40);
      }
      x.putImageData(im0, 0, 0);
      x.lineCap = 'round'; x.lineJoin = 'round';
      x.strokeStyle = 'rgb(70,64,58)'; x.lineWidth = 9;
      x.beginPath(); x.moveTo(40, 140);
      x.bezierCurveTo(140, 20, 200, 170, 270, 90);
      x.bezierCurveTo(330, 20, 360, 160, 430, 80);
      x.bezierCurveTo(470, 40, 520, 120, 560, 70); x.stroke();
      const im = x.getImageData(0, 0, W, H), d = im.data;
      for (let i = 0; i < d.length; i += 4) if (d[i + 3] > 128) d[i + 3] = Math.round(d[i + 3] * 0.62);
      x.putImageData(im, 0, 0);
      return c;
    }

    /* FIXTURE 3 — an ordinary well-lit signature, so the change is shown NOT to
     * disturb the common case. */
    function ordinary() {
      const W = 600, H = 180;
      const c = document.createElement('canvas'); c.width = W; c.height = H;
      const x = c.getContext('2d');
      x.lineCap = 'round'; x.lineJoin = 'round';
      x.strokeStyle = 'rgba(40,34,30,1)'; x.lineWidth = 9;
      x.beginPath(); x.moveTo(40, 140);
      x.bezierCurveTo(140, 20, 200, 170, 270, 90);
      x.bezierCurveTo(330, 20, 360, 160, 430, 80); x.stroke();
      return c;
    }

    const toImg = (u) => new Promise((r) => { const i = new Image(); i.onload = () => r(i); i.src = u; });
    const stats = async (canvas, url) => {
      const src = canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height).data;
      let vis = 0;
      for (let i = 3; i < src.length; i += 4) if (src[i] >= 25) vis++;
      const im = await toImg(url);
      const o = document.createElement('canvas'); o.width = canvas.width; o.height = canvas.height;
      o.getContext('2d').drawImage(im, 0, 0);
      const d = o.getContext('2d').getImageData(0, 0, o.width, o.height).data;
      let kept = 0;
      for (let i = 3; i < d.length; i += 4) if (d[i] >= 128) kept++;
      const total = canvas.width * canvas.height;
      return { visPct: +(vis / total * 100).toFixed(2), keptPct: +(kept / total * 100).toFixed(2),
        keptOfVis: vis ? +(kept / vis * 100).toFixed(1) : 0 };
    };

    const out = [];
    for (const [name, make] of [['pale-and-dark', paleAndDark], ['residue', residue], ['ordinary', ordinary]]) {
      const c = make();
      const u1 = window.__v1(c);        // the functions take an <img>, and a
      const u2 = window.__v2(c);        // canvas answers naturalWidth via width
      out.push({ name, same: u1 === u2, s: await stats(c, u2) });
    }
    return out;
  });

  console.log('T1  V1 and V2 produce the SAME print copy');
  results.forEach((r) => check('  ' + r.name + ' is byte-identical across the two apps', r.same, true));

  console.log('T2  a pale signature is not erased, and a residue one is not flooded');
  const by = Object.fromEntries(results.map((r) => [r.name, r.s]));
  console.log('     ' + results.map((r) => r.name + ': visible ' + r.s.visPct
    + '% -> printed ' + r.s.keptPct + '% (' + r.s.keptOfVis + '% of the ink)').join('\n     '));
  // Pre-fix this printed 33.3% of the ink. A fragment on a filed record is the
  // worst outcome this file has — worse than either defect it replaced.
  check('most of a PALE signature reaches paper', by['pale-and-dark'].keptOfVis > 80, true);
  // ...and the other end of the dial, which the pale fixture cannot see.
  check('...while a RESIDUE one stays a signature, not a black box', by.residue.keptPct < 6, true);
  check('an ordinary signature is untouched by any of this', by.ordinary.keptOfVis > 80, true);

  await b.close();
  console.log('\n' + pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})();
