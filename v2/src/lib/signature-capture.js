/* Capturing a signature: photo → transparent, trimmed PNG.
 *
 * Ported from index.html LINE BY LINE. Read docs/KAD-REKOD.md §5 first.
 *
 * ── Why this is capture-side and the print fix is not ────────────────────
 *
 * A signed row is PERMANENT and its image can NEVER be re-uploaded. So this
 * code only ever affects signatures taken from now on; it can do nothing for a
 * card already filed. That is exactly why the two print defects (§4.15) had to
 * be fixed at RENDER time in signature-print.js, and why `stripSignatureBg` was
 * deliberately left alone when they were fixed. Do not "improve" this in the
 * belief that it will help an existing record — it cannot.
 *
 * ── What it does ─────────────────────────────────────────────────────────
 *
 * Officers photograph a signature on paper, so the input is a photo, not a
 * PNG with an alpha channel:
 *
 *  1. If the source already carries real transparency, respect it and skip the
 *     keying entirely — re-keying an already-clean PNG would eat the ink.
 *  2. Otherwise estimate the paper brightness from the histogram (the top ~10%
 *     of pixels are paper), then ramp alpha between `lo` and `hi`. The ramp is
 *     what keeps stroke edges smooth — and it is also why a badly-lit photo
 *     leaves the background at low-but-non-zero alpha, which is the whole
 *     origin of the printed black box. signature-print.js thresholds that away
 *     at render time.
 *  3. Darken surviving pixels to 72% of their own colour. NOT to black — the
 *     pen's own colour is kept, which is why the print path exists separately.
 *  4. Trim the empty margins so the ink fills the small T.T cell.
 */

export function stripSignatureBg(srcCanvas) {
  const w = srcCanvas.width, h = srcCanvas.height;
  const ctx = srcCanvas.getContext('2d');
  let im = ctx.getImageData(0, 0, w, h);
  let d = im.data;
  const n = d.length;
  let i, lum;

  // Does the source already carry real transparency? If so, respect it.
  let clear = 0;
  for (i = 3; i < n; i += 4) { if (d[i] < 200) clear++; }
  const alreadyHasAlpha = clear > (n / 4) * 0.05;

  if (!alreadyHasAlpha) {
    // Estimate the paper brightness: walk the histogram down from white until
    // we have covered the brightest ~10% of pixels.
    const hist = new Uint32Array(256);
    for (i = 0; i < n; i += 4) {
      lum = ((d[i] * 299 + d[i + 1] * 587 + d[i + 2] * 114) / 1000) | 0;
      hist[lum]++;
    }
    const total = n / 4;
    let acc = 0, paper = 255;
    for (let v = 255; v >= 0; v--) { acc += hist[v]; if (acc >= total * 0.10) { paper = v; break; } }

    // At/above hi is paper (fully clear); at/below lo is ink (solid). Between
    // them the alpha ramps, which keeps stroke edges smooth.
    const hi = Math.max(60, paper * 0.92), lo = hi * 0.55, span = Math.max(1, hi - lo);
    let a;
    for (i = 0; i < n; i += 4) {
      lum = (d[i] * 299 + d[i + 1] * 587 + d[i + 2] * 114) / 1000;
      if (lum >= hi) a = 0;
      else if (lum <= lo) a = 255;
      else a = Math.round((hi - lum) / span * 255);
      if (a > 0) { d[i] = (d[i] * 0.72) | 0; d[i + 1] = (d[i + 1] * 0.72) | 0; d[i + 2] = (d[i + 2] * 0.72) | 0; }
      d[i + 3] = a;
    }
    ctx.putImageData(im, 0, 0);
    im = ctx.getImageData(0, 0, w, h);
    d = im.data;
  }

  // Trim empty margins around the ink.
  let minX = w, minY = h, maxX = -1, maxY = -1, x, y;
  for (y = 0; y < h; y++) {
    for (x = 0; x < w; x++) {
      if (d[(y * w + x) * 4 + 3] > 16) {
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }
    }
  }
  if (maxX < 0) return srcCanvas;                  // nothing found — keep original
  const pad = Math.round(Math.max(w, h) * 0.02);
  minX = Math.max(0, minX - pad); minY = Math.max(0, minY - pad);
  maxX = Math.min(w - 1, maxX + pad); maxY = Math.min(h - 1, maxY + pad);
  const tw = maxX - minX + 1, th = maxY - minY + 1;
  if (tw < 8 || th < 4) return srcCanvas;          // too small to be a signature
  const out = document.createElement('canvas');
  out.width = tw; out.height = th;
  out.getContext('2d').drawImage(srcCanvas, minX, minY, tw, th, 0, 0, tw, th);
  return out;
}

/* Scale a chosen photo down and key it. Resolves to a data URL, or null.
 * PNG, because it is the only one of the two that keeps transparency. */
export function resizeImage(file, maxDim) {
  return new Promise((resolve) => {
    try {
      const img = new Image();
      const url = URL.createObjectURL(file);
      img.onload = () => {
        const w = img.width || 1, ht = img.height || 1;
        const scale = Math.min(1, maxDim / Math.max(w, ht));
        const cw = Math.max(1, Math.round(w * scale));
        const ch = Math.max(1, Math.round(ht * scale));
        const c = document.createElement('canvas');
        c.width = cw; c.height = ch;
        c.getContext('2d').drawImage(img, 0, 0, cw, ch);
        URL.revokeObjectURL(url);
        // If keying fails for any reason, fall back to the plain resized image
        // rather than losing the signature altogether.
        try { resolve(stripSignatureBg(c).toDataURL('image/png')); }
        catch (e) {
          try { resolve(c.toDataURL('image/png')); } catch (e2) { resolve(null); }
        }
      };
      img.onerror = () => { URL.revokeObjectURL(url); resolve(null); };
      img.src = url;
    } catch (e) { resolve(null); }
  });
}

export function dataUrlToBlob(durl) {
  const a = String(durl).split(',');
  const m = (a[0].match(/:(.*?);/) || [])[1] || 'image/png';
  const b = atob(a[1]);
  let n = b.length;
  const u = new Uint8Array(n);
  while (n--) u[n] = b.charCodeAt(n);
  return new Blob([u], { type: m });
}

/* The storage path for a new signature.
 * Timestamped so it is unique: `upsert:false` on the upload means a collision
 * would be an error rather than a silent overwrite, and a signature image must
 * never be replaceable. */
export function signaturePath(hydrantId, sec, ri) {
  return hydrantId + '/' + sec + '_' + ri + '_' + Date.now() + '.png';
}
