import { defineStore } from 'pinia';
import { pageAll, shouldApply, mapRows, shouldPull, PULL_EVERY } from './hydrants-logic.js';

export { pageAll, shouldApply, mapRows, shouldPull, PULL_MIN, PULL_EVERY, LOAD_PAGE, LOAD_MAX } from './hydrants-logic.js';

const STORE_KEY = 'bbpkunak_hydrants_v2';

export const useHydrantsStore = defineStore('hydrants', {
  state: () => ({
    list: [],
    lastPull: 0,
    // Set by a background pull so the map does not re-fit. A pull that brings a
    // hydrant someone else added changes the fit key, and a re-fit would jump
    // the view away from what the officer is reading (CLAUDE.md §3).
    noFitOnce: false,
  }),

  actions: {
    loadLocal(seed) {
      try {
        const raw = window.localStorage.getItem(STORE_KEY);
        if (raw) { const d = JSON.parse(raw); if (Array.isArray(d) && d.length) { this.list = d; return; } }
      } catch (e) { /* storage blocked — fall through to the seed */ }
      this.list = JSON.parse(JSON.stringify(seed || []));
    },

    persist() {
      try { window.localStorage.setItem(STORE_KEY, JSON.stringify(this.list)); return true; }
      catch (e) { return false; }
    },

    /* Read the whole register, paged.
     *
     * Only replaces local state once EVERY page is in, and only if something
     * came back. A partial or empty read is worse than no read: on screen it
     * looks exactly like hydrants were deleted.
     */
    async pull(sb, quiet) {
      if (!sb) return false;
      const paged = await pageAll((from, to) =>
        sb.from('hydrants')
          .select('id,label,lat,lng,status,location,last_inspected')
          .order('id', { ascending: true })
          .range(from, to));
      if (!paged || !shouldApply(paged.rows)) return false;   // keep the local copy
      this.list = mapRows(paged.rows, this.list);
      this.persist();
      if (quiet) this.noFitOnce = true;
      return true;
    },

    // Throttled so flicking between tabs does not hammer a field connection.
    async pullFresh(sb, force) {
      const now = Date.now();
      if (!shouldPull(now, this.lastPull, force)) return false;
      this.lastPull = now;
      return this.pull(sb, true);
    },

    // Foreground/focus/online plus a poll — a device left open on the counter
    // never fires a foreground event, so foreground alone is not enough.
    startPolling(sb) {
      return setInterval(() => {
        if (typeof document !== 'undefined' && document.hidden) return;
        this.pullFresh(sb, false);
      }, PULL_EVERY);
    },
  },
});
