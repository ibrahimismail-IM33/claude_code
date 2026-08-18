/* The offline queue's decision table, as pure functions.
 *
 * Kept separate from the store on purpose: no Pinia import, no `window`, no
 * localStorage. That is what lets tests/v2-pending-parity.js run this side by
 * side with V1's real flushPending in a browser and require the two to agree on
 * every input combination.
 *
 * Ported from index.html LINE BY LINE and deliberately not improved. Three
 * defects have lived here (CLAUDE.md §4.10, §4.13, §4.14) and each one lost, or
 * nearly lost, inspection data an officer had typed in the field. A tidier
 * version of this that is subtly different is worth less than an ugly one that
 * is identical.
 */

export function sameData(a, b) {
  try { return JSON.stringify(a || {}) === JSON.stringify(b || {}); } catch (e) { return false; }
}

/* What may be pushed, what may be deleted, what must stay parked.
 *
 *   parked  queued rows: {section,row_index,data,base,removed}
 *   cloud   what the server holds right now, keyed "section|row_index",
 *           as {data, signed}
 *
 * `base` is what the cloud held when the card was opened — the thing that
 * separates "nobody else touched this" from "someone changed it after I went
 * offline". Guessing between those two is what lost the data in the first
 * place. `base === undefined` means the cloud was never read this session, and
 * must mean "change nothing": acting on a snapshot we never took would remove
 * rows this device has simply not seen yet.
 */
export function planFlush(parked, cloud) {
  const push = [], drop = [], keep = [];
  parked.forEach((row) => {
    const cur = cloud[row.section + '|' + row.row_index];
    if (cur && cur.signed) { keep.push(row); return; }   // signed is permanent, never overwrite
    if (row.removed) {
      if (!cur) return;                                   // already gone — nothing to do
      if (row.base !== undefined && sameData(cur.data, row.base)) { drop.push(row); return; }
      keep.push(row);                                     // someone else changed it: cloud wins, warn
      return;
    }
    if (!cur) { push.push(row); return; }                 // nothing there to lose
    if (row.base !== undefined && sameData(cur.data, row.base)) { push.push(row); return; }
    if (sameData(cur.data, row.data)) return;             // already identical — done
    keep.push(row);                                       // someone else changed it: cloud wins, warn
  });
  return { push, drop, keep };
}

/* What stays parked after an attempt.
 *
 * A flush that fails must change NOTHING. Anything that did not land goes back
 * in the queue — dropping a failed push would leave the typing in the form
 * cache, no longer flagged as unsent, and overwritten by the cloud on the next
 * open. That is §4.10 returning on a flaky connection rather than a clean
 * outage, which is the more common case in the field.
 */
export function settle(plan, okPushed, okDropped) {
  let left = plan.keep.slice();
  if (!okPushed) left = left.concat(plan.push);
  if (!okDropped) left = left.concat(plan.drop);
  return left;
}

/* The offline-conflict banner's list items, built EXACTLY as V1's
 * renderPendingNotice (index.html:2412-2429).
 *
 * When a row an officer typed offline was ALSO changed on another device, the
 * cloud wins (§3) — but silently choosing a winner is what lost data in the
 * first place (§4.10). So the officer is shown what they typed, per row, and
 * can put it back or drop it. This is the on-card half of that promise; without
 * it the typing is parked but INVISIBLE, which is §4.10 wearing a quieter face.
 *
 * Pure and self-contained — a LOCAL esc(), no imports — so it stays runnable in
 * node beside V1 the way planFlush is (tests/v2-pending-banner.js).
 *
 * THE ESCAPING IS THE SAFETY PROPERTY. The card renders each string with
 * `v-html` (KadRekod.vue), so every value the officer typed passes through
 * esc() before it is wrapped in <b>. Only the <li>/<b>/· structure is literal
 * markup; nothing from the officer's typing is. An unescaped value here would
 * be stored XSS on a legal record — which is why V1 escaped it and why this
 * transcription must not "simplify" the esc() away.
 *
 * Input is the parked rows array (`pending.load(id).rows`): each
 * `{ section, row_index, data, base, removed }`. Returns an array of <li> HTML
 * strings; a row with nothing worth showing contributes none.
 */
const SEC_TITLE = {
  header: 'Maklumat pili',
  kerosakan: 'Kerosakan',
  pemantauan: 'Pemantauan',
  pengujian: 'Pengujian',
  kompaun: 'Kompaun',
};

function esc(s) {
  return String(s == null ? '' : s).replace(/[&<>"]/g, (m) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[m]));
}

export function buildPendingItems(rows) {
  return (rows || []).map((r) => {
    const where = esc(SEC_TITLE[r.section] || r.section)
      + (r.section === 'header' ? '' : ' · baris ' + (r.row_index + 1));
    // A removal carries no data, so say what it WAS rather than a blank line
    // the officer cannot interpret.
    if (r.removed) {
      const was = Object.keys(r.base || {})
        .filter((k) => k !== 'tt' && String(r.base[k] || '').trim() !== '')
        .map((k) => esc(k) + ': <b>' + esc(r.base[k]) + '</b>');
      return '<li>' + where + ' — <b>anda kosongkan baris ini</b>'
        + (was.length ? ' (asal — ' + was.join(' · ') + ')' : '') + '</li>';
    }
    const vals = Object.keys(r.data || {})
      .filter((k) => k !== 'tt' && String(r.data[k] || '').trim() !== '')
      .map((k) => esc(k) + ': <b>' + esc(r.data[k]) + '</b>');
    if (!vals.length) return '';
    return '<li>' + where + ' — ' + vals.join(' · ') + '</li>';
  }).filter(Boolean);
}
