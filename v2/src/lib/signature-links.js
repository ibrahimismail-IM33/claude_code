/* Signed links for signature images.
 *
 * Signature images are personal data and the `signatures` bucket is PRIVATE.
 * Rather than a public URL anyone with the link can fetch, the card asks the
 * server for a short-lived signed link at the moment it opens.
 *
 * Three things this has to survive, and all three are why it looks defensive:
 *
 *  - **Rows signed before the bucket was locked down** hold a full public URL
 *    in `_sig` rather than a storage path. `sigPath()` extracts the path from
 *    it. A signed row is PERMANENT and can never be re-uploaded, so those old
 *    values can only ever be read, never corrected.
 *  - **The request failing, or the bucket still being public.** Then we fall
 *    back to the stored value, which is exactly what the app used before. On a
 *    public bucket that is the image; on a private one it will not load — but
 *    a cell that stays blank forever is worse, because on a signed row it reads
 *    as the signature having been lost.
 *  - **Reopening a card.** Links are cached for their lifetime, so going back
 *    into a card costs no round trip and the signature is there on first paint.
 *
 * `_sigUrl` is NEVER persisted — it expires. `formFingerprint` excludes it for
 * that reason, or every card would look changed on every open.
 */
export const SIG_TTL = 3600;            // an hour is plenty to read and print

const CACHE = new Map();                // path -> { url, exp }

// Exported for tests; nothing in the app should need to clear this.
export function _resetSigCache() { CACHE.clear(); }

/* The durable reference, whatever form it was stored in. */
export function sigPath(v) {
  const s = String(v == null ? '' : v);
  if (!s) return '';
  const m = s.match(/\/object\/(?:public|sign)\/signatures\/([^?]+)/);
  if (m) return decodeURIComponent(m[1]);   // legacy full URL
  if (/^https?:/i.test(s)) return '';       // some other URL — cannot sign it
  return s;                                 // already a path
}

/* Anything left without a link falls back to the value stored on the row. */
function fallbackRest(f, order) {
  order.forEach((s) => {
    (f[s] || []).forEach((r) => {
      if (r && r._signed && r._sig && !r._sigUrl) r._sigUrl = r._sig;
    });
  });
  return f;
}

/* Resolve every signature on a card. Mutates the rows' `_sigUrl` and resolves
 * when there is nothing further to wait for — the caller paints and moves on.
 *
 * NOTE the cache check uses `exp > now + 30s`: a link that is about to expire
 * is treated as missing, so a card left open does not paint a URL that dies
 * while the officer is reading it. */
export async function resolveSigs(sb, f, order) {
  if (!f) return f;
  if (!sb) return fallbackRest(f, order);

  const targets = [];
  order.forEach((s) => {
    (f[s] || []).forEach((r) => {
      if (r && r._signed && r._sig) {
        const p = sigPath(r._sig);
        if (p) targets.push({ row: r, path: p });
      }
    });
  });

  const now = Date.now();
  const miss = [];
  targets.forEach((t) => {
    const c = CACHE.get(t.path);
    if (c && c.exp > now + 30000) t.row._sigUrl = c.url;
    else miss.push(t);
  });
  if (!miss.length) return fallbackRest(f, order);

  const paths = miss.map((t) => t.path);
  try {
    const res = await sb.storage.from('signatures').createSignedUrls(paths, SIG_TTL);
    if (res && !res.error && Array.isArray(res.data)) {
      res.data.forEach((d, i) => {
        // Supabase has spelled this both ways across versions; accept either
        // rather than silently resolving nothing.
        const u = d && (d.signedUrl || d.signedURL);
        if (u && miss[i]) {
          miss[i].row._sigUrl = u;
          CACHE.set(miss[i].path, { url: u, exp: Date.now() + SIG_TTL * 1000 });
        }
      });
    }
  } catch (e) {
    /* offline, or the bucket is still public — fall through to the fallback */
  }
  return fallbackRest(f, order);           // whatever the server did not sign
}
