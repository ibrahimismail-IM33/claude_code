import { defineStore } from 'pinia';
export { planFlush, settle, sameData, buildPendingItems } from './pending-logic.js';

/* The offline queue. Ported from index.html line by line, NOT redesigned.
 *
 * Three separate defects live in this logic and every one of them destroyed or
 * nearly destroyed real inspection data:
 *
 *   §4.10  A failed save was overwritten by the cloud copy the next time the
 *          card was opened. Gone from the screen and the device, never sent.
 *   §4.13  A cleared row came back, because an upsert never deletes the rows it
 *          is not sent. Clearing had never been implemented at all.
 *   §4.14  A failed flush dropped the pushed rows from the queue, putting the
 *          typing back in exactly the position §4.10 exists to prevent.
 *
 * So this is a transcription, not an improvement. The one structural change is
 * that the decision table lives in ./pending-logic.js as pure functions, with
 * no Pinia, no window and no localStorage — which is what lets
 * tests/v2-pending-parity.js run it beside V1's real flushPending in a browser
 * and require the two to agree on every input combination. It is re-exported
 * here so callers have one import.
 */

export const KEY_PREFIX = 'bbpkunak_pending_';
export const pendKey = (id) => KEY_PREFIX + id;

export const usePendingStore = defineStore('pending', {
  state: () => ({
    // What the cloud held when each card was opened, keyed by hydrant id then
    // "section|row_index". The base for the three-way comparison above.
    cloudBase: {},
  }),

  getters: {
    // Which cards have unsent work. The map pin carries an amber "!" for these
    // and the card shows a banner — an officer should not have to open every
    // pili to find what has not synced.
    ids: () => {
      const out = [];
      try {
        for (let i = 0; i < window.localStorage.length; i++) {
          const k = window.localStorage.key(i);
          if (k && k.indexOf(KEY_PREFIX) === 0) out.push(+k.slice(KEY_PREFIX.length));
        }
      } catch (e) { /* storage unavailable — treat as nothing parked */ }
      return out;
    },
  },

  actions: {
    load(id) {
      try {
        const raw = window.localStorage.getItem(pendKey(id));
        const p = raw ? JSON.parse(raw) : null;
        return (p && Array.isArray(p.rows) && p.rows.length) ? p : null;
      } catch (e) { return null; }
    },

    save(id, p) {
      try {
        if (p && p.rows && p.rows.length) window.localStorage.setItem(pendKey(id), JSON.stringify(p));
        else window.localStorage.removeItem(pendKey(id));
      } catch (e) { /* storage full or blocked; the row is still on screen */ }
    },

    has(id) { return !!this.load(id); },

    /* Every hydrant with unsent work, found by scanning the key prefix. Used to
     * push everything on reconnect: an officer should not have to open each
     * pili to discover what has not synced (CLAUDE.md §3). */
    ids() {
      const out = [];
      try {
        for (let i = 0; i < window.localStorage.length; i++) {
          const k = window.localStorage.key(i);
          if (k && k.indexOf(KEY_PREFIX) === 0) out.push(+k.slice(KEY_PREFIX.length));
        }
      } catch (e) { /* storage blocked */ }
      return out;
    },

    snapCloudBase(id, rows) {
      const m = {};
      (rows || []).forEach((r) => { m[r.section + '|' + r.row_index] = r.data || {}; });
      this.cloudBase[id] = m;
    },

    // undefined  = never saw the cloud this session (so: delete nothing)
    // null       = the row did not exist there
    baseFor(id, sec, ri) {
      const m = this.cloudBase[id];
      if (!m) return undefined;
      return m[sec + '|' + ri] || null;
    },
  },
});
