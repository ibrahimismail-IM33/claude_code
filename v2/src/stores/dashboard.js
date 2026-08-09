import { defineStore } from 'pinia';
import { scanLocal, scanPages, mergeIndex, SCAN_PAGE } from './dashboard-logic.js';

/* The Pengujian index the dashboard is built from.
 *
 * THE KEY ARCHITECTURAL DECISION (CLAUDE.md §2): the dashboard stores no
 * numbers of its own. Every figure is derived from the same Pengujian rows the
 * record card writes — signed row in the period = Diperiksa, unsigned dated row
 * = Belum di-sign, no row = Belum diperiksa. One source of truth, nothing to
 * drift.
 *
 * This store existed as pure functions from Phase 2 and was never called by the
 * app: `App.vue` passed `() => 'none'` and an empty index, so every hydrant read
 * "Belum diperiksa" while 68 parity assertions passed. The logic was right; the
 * join was missing. Worth remembering the shape — components proven in
 * isolation are not a working view.
 *
 * Local first, cloud merged in:
 *
 *  - `scanLocal` is SYNCHRONOUS, so the dashboard has real figures on the very
 *    first paint. A device that has never opened a card still shows totals.
 *  - The cloud read is paged. §4.1: Supabase caps a request at 1000 rows and
 *    reports NO error, so an unbounded read silently dropped the rest and those
 *    hydrants counted as never inspected — it would have read ~67 hydrants and
 *    reported 120 as never inspected. Ordered by hydrant_id then row_index so
 *    `range()` cannot repeat or skip between pages.
 *  - A null cloud result KEEPS the local index. A failed read must never blank
 *    figures that are real.
 *
 * `source` is shown to the officer rather than assumed: a device-only figure
 * and a confirmed one must be tellable apart.
 */
export const useDashboardStore = defineStore('dashboard', {
  state: () => ({
    index: {},
    source: '',
    scanning: false,
  }),

  actions: {
    /* `readForm` is passed in (the records store's `load`) rather than imported,
     * so this stays testable without localStorage and there is one definition of
     * how a cached card is read. */
    async refresh(sb, hydrants, readForm) {
      const local = scanLocal(hydrants, readForm);
      this.index = local;
      this.source = sb ? 'Menyemak awan…' : 'Data peranti ini';
      if (!sb) return this.index;

      this.scanning = true;
      const cloud = await scanPages((from, to) =>
        sb.from('hydrant_records')
          .select('hydrant_id,data,signed')
          .eq('section', 'pengujian')
          .order('hydrant_id', { ascending: true })
          .order('row_index', { ascending: true })
          .range(from, to));
      this.scanning = false;

      if (!cloud) { this.source = 'Data peranti ini'; return this.index; }
      this.index = mergeIndex(local, cloud);
      this.source = 'Data awan ✓';
      return this.index;
    },
  },
});

export { SCAN_PAGE };
