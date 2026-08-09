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

    /* Write ONE hydrant row back to the server.
     *
     * V2 had no such action at all — the only writes to `hydrants` were the
     * paged read and the INSERT behind Tambah Pili. So saving a Kad Rekod
     * updated `lastInspected` in memory and in localStorage and stopped there.
     *
     * That is invisible on the device that typed it, because `mapRows` falls
     * back to `known[r.id]` and preserves the local value across a pull. It is
     * blank on every OTHER device, and blank after any cache clear — which is
     * how it was reported: "date last inspected not showing on hydrant".
     *
     * Ported from V1's `cloudSave`, same columns. Upsert rather than update:
     * V1 upserts here, and the row always exists by this point.
     *
     * Deliberately fire-and-forget, exactly as V1 is. The local copy is already
     * saved, so a failed write costs the officer nothing now and is corrected
     * on the next save; blocking the card's Save on a field connection would be
     * the worse trade. */
    async saveOne(sb, h) {
      if (!sb || !h) return false;
      try {
        const res = await sb.from('hydrants').upsert({
          id: h.id, label: h.label, lat: h.lat, lng: h.lng, status: h.status,
          location: h.location || null, last_inspected: h.lastInspected || null,
        });
        return !(res && res.error);
      } catch (e) { return false; }
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
