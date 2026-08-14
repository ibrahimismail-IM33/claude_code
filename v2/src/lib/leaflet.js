/* The Leaflet seam.
 *
 * The suites stub `window.L` with a handful of no-ops so the map never has to
 * render or fetch a tile, and V2 must keep working against that stub unedited —
 * that seam is what makes the suites framework-agnostic and usable as the
 * migration contract (docs/V2-ROADMAP.md).
 *
 * THE IMPORT MUST STAY LAZY. A static `import * as L from 'leaflet'` looks
 * equivalent and is not: Leaflet ASSIGNS ITSELF TO window.L when it loads, so a
 * static import overwrites the test's stub before the app ever asks for it. The
 * component then drives the real library against a fake DOM and every assertion
 * reads zero. Found exactly that way — the map mounted with real
 * `leaflet-container` classes while the stub sat unused.
 *
 * (V1 dodges this only by accident: its suites copy index.html to a temp dir
 * without vendor/, so the <script src="vendor/leaflet.js"> 404s and the stub
 * survives. V2 bundles its dependencies, so it needs the check to be explicit.)
 *
 * Lazy loading also keeps Leaflet out of the main chunk, which is where it
 * belongs — the map is one tab.
 *
 * Note what is deliberately NOT here: any attempt to wrap markers in Vue
 * components. 187 markers plus clustering driven through Vue's reactivity is
 * slower than Leaflet's own handling and buys nothing, so Leaflet stays
 * imperative behind this boundary for the whole migration.
 */
let real = null;

function stub() {
  return (typeof window !== 'undefined' && window.L) || null;
}

/* Resolve the library, loading it only if nothing has provided one.
 * leaflet.markercluster is a side-effect plugin that attaches
 * `markerClusterGroup` to the L it finds, so it is imported only alongside the
 * real library — never over a stub, which it would throw on. */
export async function loadL() {
  const s = stub();
  if (s) return s;
  if (!real) {
    let mod;
    try {
      mod = await import('leaflet');
    } catch (e) {
      /* The Leaflet chunk failed to load — the classic across-a-deploy skew: a
         tab open when a new build shipped asks for a hashed chunk the new build
         purged, so the dynamic import 404s. Return null rather than let the
         rejection propagate: MapView then shows a reload notice instead of a
         silent blank map (§4). main.js also listens for vite:preloadError and
         reloads once, which usually fixes it before this is reached. */
      return null;
    }
    real = mod.default || mod;
    if (typeof window !== 'undefined') window.L = real;
    try { await import('leaflet.markercluster'); }
    catch (e) { /* clustering unavailable; MapView falls back to a layer group */ }
  }
  return real;
}

// Synchronous accessor for code that already knows the library is resolved.
export function getL() {
  return stub() || real;
}
