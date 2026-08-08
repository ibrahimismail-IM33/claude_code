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
  let peak = 0;
  for (let i = 3; i < d.length; i += 4) if (d[i] > peak) peak = d[i];
  if (!peak) return '';                        // nothing visible at all
  const t = peak * SIG_PRINT_CUT;
  for (let i = 0; i < d.length; i += 4) {
    if (d[i + 3] >= t) { d[i] = 0; d[i + 1] = 0; d[i + 2] = 0; d[i + 3] = 255; }
    else { d[i + 3] = 0; }
  }
  x.putImageData(im, 0, 0);
  return c.toDataURL('image/png');
}

/* Attach a print copy beside every signature on the card.
 * Best-effort by design: the on-screen <img> is never touched or reloaded, so a
 * failure here can only cost print quality, never the signature itself. */
export function addPrintSigs(root) {
  if (!root) return;
  root.querySelectorAll('img.sigimg').forEach((img) => {
    if (img.getAttribute('data-printsrc')) return;      // already handled
    img.setAttribute('data-printsrc', '1');
    const probe = new Image();
    probe.crossOrigin = 'anonymous';                    // needed to read pixels
    probe.onload = () => {
      let url = '';
      try { url = signatureForPrint(probe); } catch (e) { return; }  // tainted -> fallback
      if (!url) return;
      const out = document.createElement('img');
      out.className = 'sigprint';
      out.alt = '';
      out.setAttribute('aria-hidden', 'true');
      out.src = url;
      if (img.parentNode) img.parentNode.insertBefore(out, img.nextSibling);
      img.classList.add('has-print');
    };
    probe.onerror = () => { /* CORS refused or gone; the fallback filter stands */ };
    probe.src = img.src;
  });
}
