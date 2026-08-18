// @ts-check
/** @typedef {import('./types').Hydrant} Hydrant */
/** @typedef {import('./types').ZoneEntry} ZoneEntry */
/** @typedef {import('./types').FilterState} FilterState */
/** @typedef {import('./types').Counts} Counts */
/* Scope, search and zones, as pure functions.
 *
 * Ported from index.html. Kept free of Pinia and the DOM so
 * tests/v2-filters-parity.js can run these beside V1's real implementations in
 * a browser and require identical answers on generated registers.
 *
 * Two rules here are load-bearing and easy to "tidy" into a bug:
 *
 *   - The three axes stack with AND, in ONE derived pass. Awam/Swasta ×
 *     inspection status × zone. Three filters that each mutate their own list
 *     is how that invariant gets broken quietly. Zon A + Awam = 97 is correct,
 *     not a defect (CLAUDE.md §3).
 *   - A search deliberately IGNORES the pills and looks at the whole register,
 *     across label and location. Nothing may be hidden from a search.
 *
 * Zones are derived from the label's leading letter and never stored: a stored
 * copy ships stale, and the user's own hand-written table was already a row
 * behind the register before it was written down.
 */

export const ZONE_RE = /^([A-Za-z])0*(\d+)$/;

/** @param {string|null|undefined} label @returns {string|null} the leading letter, upper-cased, or null */
export function zoneOf(label) {
  const m = ZONE_RE.exec(String(label == null ? '' : label).trim());
  return m ? m[1].toUpperCase() : null;
}

/** @param {string} z @param {number} n @returns {string} e.g. ("A", 7) → "A07" */
export function zoneLabel(z, n) {
  return z + (n < 10 ? '0' + n : String(n));
}

/** @param {Hydrant[]} hydrants @param {string} query @returns {Hydrant[]|null} null when the query is blank */
export function searchMatches(hydrants, query) {
  const q = String(query || '').trim().toLowerCase();
  if (!q) return null;
  return hydrants.filter((h) =>
    String(h.label || '').toLowerCase().indexOf(q) >= 0 ||
    String(h.location || '').toLowerCase().indexOf(q) >= 0);
}

/* `inspStatusOf` is passed in rather than imported: it depends on the selected
 * period and on the Pengujian rows, which belong to the records store. Keeping
 * it a parameter is what lets this stay pure and directly comparable to V1.
 * @param {Hydrant[]} hydrants
 * @param {FilterState} filters
 * @param {(h: Hydrant) => string} inspStatusOf
 * @returns {Hydrant[]}
 */
export function visible(hydrants, { status, insp, zone, query }, inspStatusOf) {
  const m = searchMatches(hydrants, query);
  if (m) return m;
  let list = status ? hydrants.filter((h) => h.status === status) : hydrants;
  if (insp) list = list.filter((h) => inspStatusOf(h) === insp);
  if (zone) list = list.filter((h) => zoneOf(h.label) === zone);
  return list;
}

/* The line under the search box.
 *
 * Ported from V1's renderSearchInfo(). Two details are decisions, not cosmetics:
 *
 *  - It says so when a pill is on. A search deliberately ignores Awam/Swasta
 *    (see `visible` above), so without the note an officer reads "3 pili
 *    dijumpai" while a pill claims to be narrowing the view, and the two
 *    disagree with no explanation. The note appears on the STATUS pill only —
 *    V1 checks `activeFilter`, not the inspection or zone axes.
 *  - The empty state is its own class. "Tiada pili dijumpai" is styled red
 *    because it is the answer an officer needs to notice.
 *
 * Returned as data rather than HTML so the assertion can be about meaning.
 * @param {number} matchCount
 * @param {string} query
 * @param {string|null|undefined} status
 * @returns {{ show: boolean, clear: boolean, count: number, none: boolean, note: boolean }}
 */
export function searchInfo(matchCount, query, status) {
  const q = String(query || '').trim();
  if (!q) return { show: false, clear: false, count: 0, none: false, note: false };
  return {
    show: true,
    clear: true,
    count: matchCount,
    none: matchCount === 0,
    note: !!status,
  };
}

/** @param {Hydrant[]} hydrants @returns {Counts} */
export function counts(hydrants) {
  const c = { kerajaan: 0, swasta: 0 };
  hydrants.forEach((h) => { c[h.status]++; });
  return c;
}

/* One row per zone with its range and count.
 *
 * This is the one panel that ignores the Awam/Swasta pills: it answers "what
 * number does the next pili get?", which is a fact about the register, not
 * about a filter. Following the pills would make zone A's range jump between
 * A114 and A91 as Swasta is toggled.
 *
 * `odd` counts labels that do not parse. They get no row — the user asked for
 * zone rows only — but a panel whose rows silently sum to less than the
 * register is misinformation, so the count is reported in the caption.
 *
 * `gap` flags a range that implies more pili than the zone holds. Dormant
 * today because every zone is contiguous; delete one pili and `A01 – A114`
 * would otherwise keep claiming 114.
 * @param {Hydrant[]} hydrants
 * @returns {{ zones: ZoneEntry[], odd: number }}
 */
export function zoneSummary(hydrants) {
  /** @type {Record<string, ZoneEntry>} */
  const by = {};
  let odd = 0;
  hydrants.forEach((h) => {
    const m = ZONE_RE.exec(String(h.label == null ? '' : h.label).trim());
    if (!m) { odd++; return; }
    const z = m[1].toUpperCase(), n = parseInt(m[2], 10);
    const e = by[z] || (by[z] = { zone: z, min: n, max: n, count: 0 });
    if (n < e.min) e.min = n;
    if (n > e.max) e.max = n;
    e.count++;
  });
  const out = Object.keys(by).sort().map((z) => {
    const e = by[z];
    e.first = zoneLabel(z, e.min);
    e.last = zoneLabel(z, e.max);
    e.gap = e.count !== (e.max - e.min + 1);
    return e;
  });
  return { zones: out, odd };
}
