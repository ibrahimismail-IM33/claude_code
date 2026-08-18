// @ts-check
/* The shared inspection schedule, as pure functions. Ported from index.html.
 *
 * The schedule lives in Supabase so the whole station shares one plan, with a
 * local copy so the app still works with no signal. Admin-only writes, matching
 * hydrants and records — one permission model, not three.
 */

/**
 * A schedule row. `t` is the visit date as ISO "YYYY-MM-DD" (see `sorted` for
 * why the string form matters); `c` is the created-at stamp used only to break
 * same-date ties; `id` is the row key.
 * @typedef {{ t?: string, c?: string, id?: (string|number) }} JadualRow
 */

/** A half-year period as [startIso, endIso], both "YYYY-MM-DD".
 * @typedef {[string, string]} Period */

export const JADUAL_PAGE = 100;

/* One folder per period, decided by the row's own Tarikh.
 *
 * Rollover therefore needs no migration: the date decides which period a row
 * belongs to, so a new half simply starts empty and nothing has to be moved.
 * @param {JadualRow[]} rows
 * @param {Period} range
 * @returns {JadualRow[]}
 */
export function inPeriod(rows, range) {
  return (rows || []).filter((r) => {
    const d = String(r.t || '');
    return d >= range[0] && d <= range[1];
  });
}

/* Latest Tarikh first.
 *
 * Dates are ISO "YYYY-MM-DD", so a plain string compare IS a date compare —
 * no parsing, and no timezone to get wrong. This supersedes two earlier orders
 * (upcoming-first, then newest-entry-first): rows sharing a date keep the
 * newest entry on top, so an admin still sees a just-added visit at the head of
 * its day, and a date added in the middle of the range slots in by date rather
 * than jumping to the top.
 */
/**
 * @param {JadualRow[]} rows
 * @param {Period} range
 * @returns {JadualRow[]}
 */
export function sorted(rows, range) {
  return inPeriod(rows, range).slice().sort((a, b) => {
    const da = String(a.t || ''), db = String(b.t || '');
    if (da !== db) return db.localeCompare(da);
    const ca = String(a.c || ''), cb = String(b.c || '');
    if (ca && cb && ca !== cb) return cb.localeCompare(ca);
    return String(b.id).localeCompare(String(a.id), undefined, { numeric: true });
  });
}

/* Bounded, but nothing is ever hidden — the rest are one tap away.
 * @param {JadualRow[]} rows
 * @param {boolean} showAll
 * @returns {JadualRow[]}
 */
export function page(rows, showAll) {
  return showAll ? rows : rows.slice(0, JADUAL_PAGE);
}

/* Parse the "YYYY-MM-DD" pieces directly instead of going through
 * new Date(iso), which reads the string as UTC midnight and renders it back in
 * the device's local timezone — on any timezone behind UTC that silently shifts
 * the displayed date back a day. That was a real "wrong date selected" bug.
 * Kunak is UTC+8, so the shift went the other way here, but the fix is the
 * parse, not the offset.
 * @param {string|null|undefined} iso
 * @returns {string}
 */
export function dmy(iso) {
  if (!iso) return '—';
  const m = String(iso).match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (m) return m[3] + '/' + m[2] + '/' + m[1];
  const d = new Date(iso);
  if (isNaN(d.getTime())) return iso;
  const pad = (n) => String(n).padStart(2, '0');
  return pad(d.getDate()) + '/' + pad(d.getMonth() + 1) + '/' + d.getFullYear();
}

/**
 * @param {JadualRow} row
 * @param {string} todayIso
 * @returns {boolean}
 */
export function isPast(row, todayIso) {
  return String(row.t || '') < todayIso;
}
