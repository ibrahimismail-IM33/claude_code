/* The printed signature.
 *
 * Ported from index.html. Read docs/KAD-REKOD.md §5 before touching any of it —
 * this is the part of the app that has produced THREE defects on paper, none of
 * which any screen or any automated measurement caught on its own:
 *
 *   1. The ink printed FADED. Darkest pixel luminance 137, not one pixel below
 *      128. It looked perfect on a backlit screen.
 *   2. The fix printed a solid BLACK BOX. `stripSignatureBg` keys the paper out
 *      with a ramp, so a badly-lit photo keeps a low-but-non-zero alpha
 *      background — and three stacked `drop-shadow` passes exist precisely to
 *      compound partial alpha toward 1. They did that to the paper too. The
 *      print went from 5.7% dark to 95.8%.
 *   3. Very nearly, the signature ERASED ENTIRELY. An absolute cutoff of 0.65
 *      wiped a signature whose ink sat at alpha 158.
 *   4. And then it DID erase one. A01 printed as a stray diagonal and four
 *      dots: a relative cutoff is still 0.65 of a SINGLE pixel, and that
 *      signature holds near-opaque blobs and pale sweeps at once, so the blobs
 *      set the peak and the sweeps fell under it. Measured off the officer's
 *      own PDF — 1.48% of the frame survived, against ~3.5% of visible ink.
 *      See SIG_PRINT_MAX_COVER.
 *
 * Three things here are load-bearing and must not be "simplified":
 *
 *  - IT IS NOT A FILTER. Measured: neither a CSS filter nor an equivalent
 *    inline SVG filter survives `page.pdf()`. The shipped CSS filter was tested
 *    as a control and came out of the PDF unfiltered, despite being confirmed
 *    black on a real printer. A pre-rendered PNG leaves the print pipeline
 *    nothing to drop.
 *  - THE CUTOFF IS RELATIVE. 0.65 **of the image's own strongest alpha**, never
 *    an absolute value. A signature missing from a filed legal record is far
 *    worse than a grey box. (Measured: 0.55 leaves residue — 7.7% dark against
 *    5.3% of real ink; 0.70 erodes the strokes to 5.2%.)
 *  - IT IS RENDER-SIDE AND PRINT-ONLY. A signed row is permanent and its image
 *    can NEVER be re-uploaded, so a capture-side fix repairs no filed record.
 *    The on-screen <img> is never touched or reloaded; the print copy is built
 *    beside it, best-effort. If the canvas cannot be read (a host refusing
 *    CORS) the fallback filter still applies to that row — faded-but-present
 *    beats absent.
 */
export const SIG_PRINT_CUT = 0.65;

/* The cutoff may be walked DOWN from SIG_PRINT_CUT, but only while what
 * survives still covers less than this much of the frame.
 *
 * ── Why a second number exists at all (2026-08-13) ───────────────────────
 *
 * `SIG_PRINT_CUT` alone is 0.65 of the image's own PEAK alpha, and a peak is a
 * single pixel. A01's signature is a blue ballpoint with a few near-opaque
 * blobs where the pen pressed and long PALE sweeps where it barely touched.
 * The blobs set the peak at 255, so the cutoff landed at 166 and every pale
 * sweep — most of the signature — was thrown away. Measured from the officer's
 * own printed PDF: the embedded image is pure black with binary alpha and
 * covers **1.48%** of its frame, against ~3.5% of visible ink. What reached
 * paper was a stray diagonal and four dots.
 *
 * That is §4.15's third defect actually happening: "a signature missing from a
 * filed legal record is far worse than a grey box". The relative cutoff fixed
 * the case where ALL the ink is faint. It cannot fix the case where one
 * signature contains both, because then the peak describes the blobs and says
 * nothing about the strokes.
 *
 * ── Why AREA is the right discriminator ──────────────────────────────────
 *
 * Lowering the cutoff risks the opposite defect: leftover paper that
 * `stripSignatureBg` could not key out sits at low-but-non-zero alpha, and
 * flooding it black is the BLACK BOX. Pale ink and pale residue can sit at the
 * SAME alpha, so no level alone separates them.
 *
 * What separates them is how much of the frame they cover. A trimmed signature
 * is a few percent of its own frame; leftover paper is most of it. So the
 * cutoff is walked down from 0.65×peak and stops the moment the surviving area
 * stops looking like ink.
 *
 * 6% was measured against both fixtures. On A01's shape the walk reaches the
 * floor and recovers the whole signature (1.15% → 3.55%, and at the printed
 * size 1.08% → 3.52% dark). On the residue fixture it stops at 77 instead of
 * 103 and keeps 5.35% instead of 5.02% — still a signature, nowhere near a box.
 *
 * THE SAFETY ARGUMENT IS THAT THIS CAN ONLY EVER LOWER THE CUTOFF. It can
 * never erase more ink than the old rule did; the only new risk is admitting
 * background, and that is exactly what the cap bounds. */
export const SIG_PRINT_MAX_COVER = 0.06;

/* Threshold alpha into binary and flood the survivors black.
 * Returns "" when there is nothing to print. Throws SecurityError on a tainted
 * canvas; the caller treats that as "no print copy" and leaves the fallback. */
export function signatureForPrint(img) {
  const w = img.naturalWidth || img.width;
  const h = img.naturalHeight || img.height;
  if (!w || !h) return '';
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  const x = c.getContext('2d');
  x.drawImage(img, 0, 0);
  const im = x.getImageData(0, 0, w, h);       // throws if tainted
  const d = im.data;

  const hist = new Uint32Array(256);
  let peak = 0;
  for (let i = 3; i < d.length; i += 4) { const a = d[i]; hist[a]++; if (a > peak) peak = a; }
  if (!peak) return '';                        // nothing visible at all

  const total = w * h;
  const ceil = Math.round(peak * SIG_PRINT_CUT);
  // A floor, so a frame of pure noise can never be flooded black.
  const floor = Math.max(4, Math.round(peak * 0.06));
  let cover = 0;
  for (let a = 255; a >= ceil; a--) cover += hist[a];
  let t = ceil;
  for (let a = ceil - 1; a >= floor; a--) {
    cover += hist[a];
    if (cover / total > SIG_PRINT_MAX_COVER) break;   // background is coming in
    t = a;
  }

  for (let i = 0; i < d.length; i += 4) {
    if (d[i + 3] >= t) { d[i] = 0; d[i + 1] = 0; d[i + 2] = 0; d[i + 3] = 255; }
    else { d[i + 3] = 0; }
  }
  x.putImageData(im, 0, 0);
  return c.toDataURL('image/png');
}

/* Read an image's bytes as a data URL, so the canvas that reads its pixels is
 * never cross-origin and can never be tainted.
 *
 * THIS IS THE FIRST ATTEMPT, not a fallback, and the reason is the one failure
 * this whole file cannot survive: if the pixels cannot be read there is no
 * print copy, and the row falls back to the amplifying CSS filter — which
 * prints either a faded signature (the filter dropped by the print pipeline) or
 * a black box (§4.15). Both are defects that have reached paper.
 *
 * A cross-origin <img crossOrigin="anonymous"> is the fragile way to get those
 * pixels: it is a SECOND request for a URL the page has already fetched without
 * CORS, so it depends on how the browser's cache treats the two modes and on
 * the response carrying its CORS header again on a revalidation. A `fetch` is
 * one clean CORS request with no image-cache interaction — and it is not a new
 * capability being introduced here, it is exactly what stores/profile.js
 * already does with these same signed links.
 *
 * `no-store` is deliberate and it is NOT free: the point is to avoid reusing a
 * response stored under a different request mode, and the cost is that a card
 * open downloads each signature a second time (they run 100–520 KB) on a phone
 * in the field. That is bought knowingly. It happens once per signature per
 * card open — `data-printsrc` stops a copy being rebuilt — and the alternative
 * is a cache entry that fails the CORS check and puts a faded signature or a
 * black box on a legal record, which is the defect this file exists for. */
function bytesAsDataUrl(src) {
  return fetch(src, { cache: 'no-store' })
    .then((r) => (r.ok ? r.blob() : Promise.reject(new Error('http ' + r.status))))
    .then((blob) => new Promise((resolve, reject) => {
      const fr = new FileReader();
      fr.onload = () => resolve(String(fr.result || ''));
      fr.onerror = () => reject(new Error('read'));
      fr.readAsDataURL(blob);
    }));
}

function loadImage(src, anon) {
  return new Promise((resolve, reject) => {
    const im = new Image();
    if (anon) im.crossOrigin = 'anonymous';
    im.onload = () => resolve(im);
    im.onerror = () => reject(new Error('load'));
    im.src = src;
  });
}

/* Attach a print copy beside every signature on the card.
 *
 * Best-effort by design: the on-screen <img> is never touched or reloaded, so a
 * failure here can only cost print quality, never the signature itself.
 *
 * Returns a promise that settles once every signature has been ATTEMPTED, so
 * the Print button can wait for the copies rather than guess at a delay. It
 * never rejects — a card must always be printable.
 *
 * A failed attempt does NOT latch. The old version set `data-printsrc` before
 * the read had resolved, so one failure was permanent for the life of the card
 * and pressing Print again could not recover it. The marker now goes on only
 * when a copy actually exists; `data-noprint` records that the row is printing
 * through the fallback filter, which is the state worth being able to see.
 */
export function addPrintSigs(root) {
  if (!root) return Promise.resolve();
  const jobs = [];
  root.querySelectorAll('img.sigimg').forEach((img) => {
    if (img.getAttribute('data-printsrc')) return;      // already has a copy
    /* An attempt already running is JOINED, not skipped. Skipping it would let
     * Print resolve instantly while the read it is waiting for is still in
     * flight — the exact race the wait exists to remove. */
    if (img.__sigPrintJob) { jobs.push(img.__sigPrintJob); return; }
    const src = img.src;
    if (!src) return;

    const render = (probe) => {
      const url = signatureForPrint(probe);             // throws if tainted
      if (!url) throw new Error('empty');
      const out = document.createElement('img');
      out.className = 'sigprint';
      out.alt = '';
      out.setAttribute('aria-hidden', 'true');
      out.src = url;
      if (img.parentNode) img.parentNode.insertBefore(out, img.nextSibling);
      img.classList.add('has-print');
      img.setAttribute('data-printsrc', '1');
      img.removeAttribute('data-noprint');
    };

    const job = bytesAsDataUrl(src)
      .then((durl) => loadImage(durl, false))
      .then(render)
      // The old path, kept as the fallback: some hosts serve an image to an
      // <img> that they will not serve to a fetch.
      .catch(() => loadImage(src, true).then(render))
      .catch(() => { img.setAttribute('data-noprint', '1'); })
      .then(() => { img.__sigPrintJob = null; });
    img.__sigPrintJob = job;
    jobs.push(job);
  });
  return Promise.all(jobs).then(() => undefined);
}
