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
