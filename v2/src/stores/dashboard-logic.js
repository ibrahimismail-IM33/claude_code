// @ts-check
/** @typedef {import('./types').Hydrant} Hydrant */
/** A period as [startIso, endIso], both "YYYY-MM-DD". @typedef {[string, string]} Range */
/** A half-year: h is 1 (Jan–Jun) or 2 (Jul–Dis). @typedef {{ y: number, h: number }} Half */
/** One indexed Pengujian row: date, signed, penguji. @typedef {{ d: string, s: boolean, p: string }} PengRow */
/** Pengujian rows keyed by hydrant id (as a string). @typedef {Record<string, PengRow[]>} PengIndex */
/* The dashboard's data layer, as pure functions. Ported from index.html.
 *
 * The key architectural decision (CLAUDE.md §2): the dashboard stores NO
 * numbers of its own. Every figure is derived from the same Pengujian rows the
 * Kad Rekod already writes —
 *
 *   Diperiksa        a row in the period, signed
 *   Belum di-sign    a row in the period, not yet signed
 *   Belum diperiksa   no row in the period at all
 *
 * One source of truth, nothing to drift. Keep it that way: a stored counter
 * here would be a second version of the truth that nobody reconciles.
 */

/* ---- period: rolling 6-month halves ---- */
/** @param {Date} d @returns {1|2} */
export function halfOf(d) { return d.getMonth() < 6 ? 1 : 2; }

/** @param {Date} [now] @returns {Half[]} the current half plus three archived, newest first */
export function halfList(now) {
  const n = now || new Date();
  let y = n.getFullYear(), h = halfOf(n);
  /** @type {Half[]} */ const out = [];
  for (let i = 0; i < 4; i++) { out.push({ y, h }); if (h === 1) { h = 2; y--; } else { h = 1; } }
  return out;
}

/** @param {Half} o @returns {Range} */
export function halfRange(o) {
  return o.h === 1 ? [o.y + '-01-01', o.y + '-06-30'] : [o.y + '-07-01', o.y + '-12-31'];
}

/** @param {Half} o @returns {string} */
export function halfLabel(o) { return (o.h === 1 ? 'Jan – Jun ' : 'Jul – Dis ') + o.y; }

/* ---- the index of Pengujian rows, by hydrant ---- */
/**
 * @param {PengIndex} idx mutated in place
 * @param {string|number} id hydrant id
 * @param {string|null|undefined} date a blank date is ignored (no row)
 * @param {boolean|undefined} signed
 * @param {string} [penguji]
 * @returns {void}
 */
export function pushRow(idx, id, date, signed, penguji) {
  if (!date) return;
  const k = String(id);
  (idx[k] = idx[k] || []).push({ d: String(date).slice(0, 10), s: !!signed, p: penguji || '' });
}

export const SCAN_PAGE = 1000;
export const SCAN_MAX = 50;     // hard stop so a bad response cannot loop forever

/* Page through every Pengujian row.
 *
 * Supabase caps one request at 1000 rows and reports NO error. 187 hydrants ×
 * 15 rows per page passes that easily once the register fills, and the failure
 * is silent — the missing rows simply read as "Belum diperiksa". An earlier
 * unbounded version would have scanned ~67 hydrants and reported 120 as never
 * inspected (CLAUDE.md §4.1).
 *
 * Ordered by hydrant_id then row_index at the call site so range() cannot
 * repeat or skip a row between pages.
 *
 * Returns null only if the FIRST page failed. A later failure keeps what has
 * been read so far, which is V1's behaviour: partial cloud data still beats
 * falling back to this device alone.
 * @param {(from: number, to: number) => Promise<{ data?: any[]|null, error?: any }>} fetchPage
 * @returns {Promise<PengIndex|null>} null only if the FIRST page failed
 */
export async function scanPages(fetchPage) {
  /** @type {PengIndex} */ const idx = {};
  let from = 0, pages = 0;
  for (;;) {
    let res;
    try { res = await fetchPage(from, from + SCAN_PAGE - 1); }
    catch (e) { return pages ? idx : null; }
    if (!res || res.error || !Array.isArray(res.data)) return pages ? idx : null;
    res.data.forEach((r) => {
      const dt = r.data && r.data.tarikh;
      pushRow(idx, r.hydrant_id, dt, r.signed, r.data && r.data.penguji);
    });
    pages++;
    if (res.data.length === SCAN_PAGE && pages < SCAN_MAX) { from += SCAN_PAGE; continue; }
    return idx;
  }
}

/* Local cache first (synchronous, so the dashboard has figures immediately),
 * cloud merged in when it arrives. A device that has never opened a card still
 * shows real totals.
 * @param {Hydrant[]} hydrants
 * @param {(id: number|undefined) => any} readForm reads a card's cached form by hydrant id
 * @returns {PengIndex}
 */
export function scanLocal(hydrants, readForm) {
  /** @type {PengIndex} */ const idx = {};
  hydrants.forEach((h) => {
    const f = readForm(h.id);
    if (!f || !Array.isArray(f.pengujian)) return;
    f.pengujian.forEach((r) => { if (r) pushRow(idx, h.id, r.tarikh, r._signed, r.penguji); });
  });
  return idx;
}

/* Merge, treating (date, penguji) as the identity of a row.
 *
 * A row present in both wins its SIGNED flag from either side — a signature
 * seen anywhere is real, and signatures are permanent, so this can only ever
 * move a row from unsigned to signed and never back.
 * @param {PengIndex} a @param {PengIndex} b @returns {PengIndex}
 */
export function mergeIndex(a, b) {
  /** @type {PengIndex} */ const out = {};
  for (const k in a) if (Object.prototype.hasOwnProperty.call(a, k)) out[k] = a[k].slice();
  for (const k in b) {
    if (!Object.prototype.hasOwnProperty.call(b, k)) continue;
    if (!out[k]) { out[k] = b[k].slice(); continue; }
    b[k].forEach((r) => {
      const dup = out[k].some((x) => x.d === r.d && x.p === r.p);
      if (dup) { out[k].forEach((x) => { if (x.d === r.d && x.p === r.p && r.s) x.s = true; }); }
      else out[k].push(r);
    });
  }
  return out;
}

/** @param {PengIndex} idx @param {string|number} id @param {Range} range @returns {PengRow[]} */
export function rowsInPeriod(idx, id, range) {
  const rows = idx[String(id)] || [];
  return rows.filter((r) => r.d >= range[0] && r.d <= range[1]);
}

/* Which bucket a pili falls in for the selected period.
 *
 * ⚠ THIS DIVERGES FROM V1 ON PURPOSE. See CLAUDE.md §3.
 *
 * V1 asked "is ANY row in the period signed?" and called the pili Diperiksa if
 * so. That reads reasonably until an officer starts the next inspection: C22
 * had a signed row from 08/08 and a fresh unsigned row from 09/08, so it
 * counted as Diperiksa while an inspection sat waiting for a signature — and
 * the card's own words are "Belum di-sign — Pengujian sudah diisi, tandatangan
 * belum", which was true of it. It also made "Pemeriksaan terkini" look broken:
 * that table lists ROWS, so it showed three unsigned rows while the counter,
 * counting PILI, said one. Both were right and they could not be reconciled.
 *
 * THE LATEST INSPECTION DECIDES. Rows on the newest date in the period: if
 * every one of them is signed the pili is Diperiksa, otherwise it is Belum
 * di-sign. So "Belum di-sign" is now a complete list of what still needs
 * signing, which is the question it is asked.
 *
 * Same-date rows are resolved together rather than by row order: the index
 * carries no row_index, and an unsigned row on the latest date needs a
 * signature whatever order it was typed in.
 * @param {PengIndex} idx @param {Hydrant} h @param {Range} range
 * @returns {'none'|'ok'|'wait'} none = no row; ok = Diperiksa; wait = Belum di-sign
 */
export function inspStatusOf(idx, h, range) {
  const rows = rowsInPeriod(idx, h.id, range);
  if (!rows.length) return 'none';
  let latest = '';
  rows.forEach((r) => { if (String(r.d) > latest) latest = String(r.d); });
  const onLatest = rows.filter((r) => String(r.d) === latest);
  return onLatest.every((r) => r.s) ? 'ok' : 'wait';
}

/* Dashboard scope follows the map's Awam/Swasta pill, INCLUDING the cleared
 * state: no pill selected means the map shows everything, so the dashboard
 * covers all 187 too. An earlier version only asked "is it swasta?" and let
 * everything else fall through, so a cleared filter silently reported "Awam"
 * (CLAUDE.md §4.3).
 * @param {Hydrant[]} hydrants @param {string|null|undefined} activeFilter @returns {Hydrant[]} */
export function dashList(hydrants, activeFilter) {
  return activeFilter ? hydrants.filter((h) => h.status === activeFilter) : hydrants;
}

/** @param {string|null|undefined} activeFilter @returns {string} */
export function dashScopeLabel(activeFilter) {
  return activeFilter === 'swasta' ? 'Swasta' : (activeFilter === 'kerajaan' ? 'Awam' : 'Semua');
}

/* "Pemeriksaan terkini" — the five most recent Pengujian rows in the period.
 *
 * V2 rendered the table shell with an unfilled <slot name="recent">, so the
 * panel was permanently empty and said nothing about it. Ported from V1's
 * renderRecent: newest date first, capped at five, and the location carried
 * through so each row's Lokasi can search the map.
 *
 * Dates are ISO, so localeCompare on the string IS a date compare — no parsing
 * and no timezone, the same reasoning as the jadual sort.
 * @param {Hydrant[]} hydrants @param {string|null|undefined} activeFilter
 * @param {PengIndex} idx @param {Range} range @param {number} [limit]
 * @returns {{ d: string, label: string|undefined, loc: string, p: string, s: boolean }[]}
 */
export function recentRows(hydrants, activeFilter, idx, range, limit = 5) {
  /** @type {Record<string, Hydrant>} */ const byId = {};
  dashList(hydrants, activeFilter).forEach((h) => { byId[String(h.id)] = h; });
  const rows = [];
  Object.keys(idx).forEach((id) => {
    const h = byId[id];
    if (!h) return;
    rowsInPeriod(idx, h.id, range).forEach((r) => {
      rows.push({ d: r.d, label: h.label, loc: h.location || '—', p: r.p || '—', s: r.s });
    });
  });
  rows.sort((a, b) => String(b.d).localeCompare(String(a.d)));
  return rows.slice(0, limit);
}

/**
 * @param {Hydrant[]} hydrants @param {string|null|undefined} activeFilter
 * @param {PengIndex} idx @param {Range} range
 * @returns {{ total: number, ok: number, wait: number, none: number }}
 */
export function dashData(hydrants, activeFilter, idx, range) {
  const list = dashList(hydrants, activeFilter);
  const d = { total: list.length, ok: 0, wait: 0, none: 0 };
  list.forEach((h) => { d[inspStatusOf(idx, h, range)]++; });
  return d;
}
