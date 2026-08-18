// @ts-check
/** @typedef {import('./types').Hydrant} Hydrant */
/* Reading the register, as pure functions. Ported from index.html.
 *
 * PostgREST caps a response at 1000 rows and reports NO error when it does, so
 * an unbounded read of a register past that size silently drops hydrants off
 * the map, out of search, and out of every count — with nothing on screen to
 * say so (CLAUDE.md §4.1). Latent at Kunak's 188. Certain at roughly five
 * districts, which is exactly what docs/PRD.md plans.
 *
 * Two behaviours here are easy to lose in a port and both are load-bearing:
 *
 *   - A failed or partial read must leave the local copy ALONE. A partial read
 *     is worse than no read: it looks like hydrants were deleted.
 *   - An empty result must not be applied either, for the same reason.
 */

export const LOAD_PAGE = 1000;
export const LOAD_MAX = 50;      // hard stop so a bad response cannot loop forever

/* Walk the pages. `fetchPage(from, to)` resolves like PostgREST does:
 * {data, error}. Returns null when the read failed at any point — the caller
 * must then keep what it already has.
 *
 * Ordered by id at the call site so range() cannot repeat or skip a row.
 * @param {(from: number, to: number) => Promise<{ data?: any[]|null, error?: any }>} fetchPage
 * @param {{ pageSize?: number, maxPages?: number }} [opts]
 * @returns {Promise<{ rows: any[], pages: number } | null>} null on any read failure
 */
export async function pageAll(fetchPage, opts = {}) {
  const pageSize = opts.pageSize || LOAD_PAGE;
  const maxPages = opts.maxPages || LOAD_MAX;
  let acc = [], from = 0, pages = 0;
  for (;;) {
    let res;
    try { res = await fetchPage(from, from + pageSize - 1); }
    catch (e) { return null; }                                  // offline / blocked
    if (!res || res.error || !Array.isArray(res.data)) return null;
    acc = acc.concat(res.data);
    pages++;
    if (res.data.length === pageSize && pages < maxPages) { from += pageSize; continue; }
    return { rows: acc, pages };
  }
}

// A short page means the end. A full page means there may be more.
/** @param {any[]|null|undefined} rows @returns {boolean} */
export function shouldApply(rows) {
  return !!(rows && rows.length);
}

/* Server rows to the app's shape.
 *
 * `lastInspected` falls back to what this device already knew: the pin's date
 * badge is derived from the Pengujian rows, which a hydrants read does not
 * carry, so dropping it would blank every badge on each background pull.
 * @param {any[]} rows server rows (snake_case: last_inspected, lat, lng…)
 * @param {Hydrant[]} [prev] the current in-memory list, for the lastInspected fallback
 * @returns {Hydrant[]}
 */
export function mapRows(rows, prev) {
  const known = {};
  (prev || []).forEach((h) => { if (h.lastInspected) known[h.id] = h.lastInspected; });
  return rows.map((r) => ({
    id: r.id,
    label: r.label,
    lat: +r.lat,
    lng: +r.lng,
    status: r.status,
    location: r.location || '',
    lastInspected: r.last_inspected || known[r.id] || '',
  }));
}

/* Throttle for the cross-device refresh.
 *
 * The app used to read the cloud once at startup and then show its cache, so a
 * second device only caught up when someone opened each hydrant by hand.
 * Foreground alone is not enough — a device left open on the counter never
 * fires one — hence the poll. Throttled so flicking between tabs does not
 * hammer a field connection, and nothing runs while the tab is hidden.
 */
export const PULL_MIN = 10000;
export const PULL_EVERY = 60000;

/** @param {number} now @param {number} lastPull @param {boolean} [force] @returns {boolean} */
export function shouldPull(now, lastPull, force) {
  if (force) return true;
  return now - lastPull >= PULL_MIN;
}
