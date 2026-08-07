import { defineStore } from 'pinia';
import { visible, counts, zoneSummary, zoneOf } from './filters-logic.js';
import { useHydrantsStore } from './hydrants.js';

export { visible, counts, zoneSummary, zoneOf, zoneLabel, searchMatches } from './filters-logic.js';

export const useFiltersStore = defineStore('filters', {
  state: () => ({
    status: null,     // Awam ('kerajaan') / Swasta ('swasta') / null = Semua
    insp: null,       // dashboard inspection status
    zone: null,       // leading letter of the label
    query: '',
  }),

  getters: {
    /* ONE derived pass, on purpose.
     *
     * The three axes stack with AND. Three filters that each maintain their own
     * list is how that invariant gets broken quietly — and it looks like a bug
     * when it works: Zon A + Awam = 97 is correct.
     *
     * `inspStatusOf` is injected by the caller because it depends on the
     * selected period and on the Pengujian rows, which belong to the records
     * store. That is also what keeps the underlying function pure and directly
     * comparable to V1's.
     */
    visibleWith: (s) => (inspStatusOf) =>
      visible(useHydrantsStore().list, s, inspStatusOf),

    counts: () => counts(useHydrantsStore().list),

    /* The one panel that IGNORES the pills.
     *
     * It answers "what number does the next pili get?", which is a fact about
     * the register, not about a filter. Following the pills would make zone A's
     * range jump between A114 and A91 as Swasta is toggled, and "the last
     * number" would stop meaning the last number.
     */
    zones: () => zoneSummary(useHydrantsStore().list),

    active: (s) => !!(s.status || s.insp || s.zone || String(s.query || '').trim()),
  },

  actions: {
    clear() { this.status = this.insp = this.zone = null; this.query = ''; },
    setZone(z) { this.zone = this.zone === z ? null : z; },
  },
});
