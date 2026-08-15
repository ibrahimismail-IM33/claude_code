import { defineStore } from 'pinia';

/* Jadual Pemeriksaan — the shared inspection schedule.
 *
 * WHY THIS FILE EXISTS
 *   `jadual-logic.js` (pure, parity-tested) and `Jadual.vue` (the panel) were
 *   both written and both correct. Nothing ever connected them: `App.vue`
 *   passed `:jadual="[]"` and bound no handler for the panel's add/update/
 *   remove events, so the feature rendered permanently empty and every write
 *   went nowhere. The logic was right; the JOIN was missing — the third time
 *   that exact shape has appeared in this migration (CLAUDE.md §5).
 *
 *   Ported from index.html's jadual section. Same table, same columns, same
 *   localStorage key, so a device that used V1 keeps its cache across cutover.
 *
 * THE PARTS THAT LOOK OPTIONAL AND ARE NOT
 *   - The cache is updated PER PERIOD, never wholesale. Replacing the whole
 *     cache would empty every other period the moment a connection drops, and
 *     an empty schedule reads as "no visits planned" rather than "not loaded".
 *   - A missing TABLE and an unreachable CLOUD say different things. Only
 *     42P01 (undefined_table) means "not set up yet"; anything else is a
 *     connection problem. Conflating them sends an admin hunting for a SQL
 *     fault that is actually a dropped signal.
 *   - Writes fall back to the LOCAL cache when there is no cloud, and rows
 *     created that way carry a `local-` id. Those are edited and deleted in
 *     place — they were never on the server, so sending them there would fail.
 *   - Admin-only writes, matching hydrants and records. One permission model.
 *     RLS enforces it regardless; this only keeps the UI honest.
 */

const JKEY = 'bbpkunak_jadual';
const TABLE = 'jadual_pemeriksaan';
const CAP = 1000;

function readCache() {
  try {
    const raw = window.localStorage.getItem(JKEY);
    const a = raw ? JSON.parse(raw) : [];
    return Array.isArray(a) ? a : [];
  } catch (e) { return []; }
}
function writeCache(a) {
  try { window.localStorage.setItem(JKEY, JSON.stringify(a)); } catch (e) { /* storage blocked */ }
}

// 42P01 is undefined_table. PostgREST also reports a stale schema cache in
// prose, which is the same situation from the client's point of view.
function tableMissing(err) {
  if (!err) return false;
  return String(err.code) === '42P01'
    || /does not exist|schema cache/i.test(String(err.message || ''));
}

export const useJadualStore = defineStore('jadual', {
  state: () => ({
    rows: readCache(),
    source: '',
    capped: false,
    cloud: false,      // did the last read actually reach the table?
    error: '',
  }),

  actions: {
    /* Read one period. The query is filtered by date, which keeps it bounded
     * without a cap that could hide rows silently — and `capped` is surfaced
     * rather than swallowed if the ceiling is ever reached anyway. */
    async load(sb, range, district = 'KUNAK') {
      this.error = '';
      if (!sb) { this.cloud = false; this.source = 'Peranti ini sahaja'; return this.rows; }

      let res;
      try {
        res = await sb.from(TABLE)
          .select('id,tarikh,pasukan,lokasi,created_at')
          .eq('district', district)                 // §7.3: this district's schedule
          .gte('tarikh', range[0]).lte('tarikh', range[1])
          .order('created_at', { ascending: false })
          .range(0, CAP - 1);
      } catch (e) {
        this.cloud = false;
        this.source = 'Awan tidak dapat dicapai — salinan peranti';
        return this.rows;
      }

      if (!res || res.error || !Array.isArray(res.data)) {
        this.cloud = false;
        this.source = tableMissing(res && res.error)
          ? 'Jadual belum disediakan di awan — peranti ini sahaja'
          : 'Awan tidak dapat dicapai — salinan peranti';
        return this.rows;
      }

      const fresh = res.data.map((r) => ({
        id: r.id, t: r.tarikh, pas: r.pasukan, l: r.lokasi, c: r.created_at || '',
      }));
      this.capped = res.data.length >= CAP;
      // Only THIS period's slice is replaced — see the note at the top.
      const others = readCache().filter((r) => {
        const d = String(r.t || '');
        return !(d >= range[0] && d <= range[1]);
      });
      this.rows = others.concat(fresh);
      writeCache(this.rows);
      this.cloud = true;
      this.source = 'Dikongsi ✓';
      return this.rows;
    },

    async add(sb, range, row, district = 'KUNAK') {
      if (!sb || !this.cloud) {
        this.rows = this.rows.concat([{
          id: 'local-' + Date.now(), t: row.t, pas: row.pas, l: row.l,
          c: new Date().toISOString(),
        }]);
        writeCache(this.rows);
        return true;
      }
      const res = await sb.from(TABLE)
        .insert({ tarikh: row.t, pasukan: row.pas, lokasi: row.l, created_by: row.by || null, district })
        .then((r) => r, () => ({ error: { message: 'rangkaian' } }));
      if (res && res.error) { this.error = 'Gagal simpan jadual: ' + (res.error.message || ''); return false; }
      await this.load(sb, range, district);
      return true;
    },

    /* A `local-` row never reached the server, so it is corrected in place;
     * anything else goes back to Supabase and the list is re-read so every
     * device sees the same correction. */
    async update(sb, range, row, district = 'KUNAK') {
      if (String(row.id).indexOf('local-') === 0 || !sb || !this.cloud) {
        this.rows = this.rows.map((r) => (String(r.id) === String(row.id)
          ? { id: r.id, t: row.t, pas: row.pas, l: row.l, c: r.c || '' } : r));
        writeCache(this.rows);
        return true;
      }
      const res = await sb.from(TABLE)
        .update({ tarikh: row.t, pasukan: row.pas, lokasi: row.l }).eq('id', row.id)
        .then((r) => r, () => ({ error: { message: 'rangkaian' } }));
      if (res && res.error) { this.error = 'Gagal kemas kini: ' + (res.error.message || ''); return false; }
      await this.load(sb, range, district);
      return true;
    },

    async remove(sb, range, id, district = 'KUNAK') {
      if (String(id).indexOf('local-') === 0 || !sb || !this.cloud) {
        this.rows = this.rows.filter((r) => String(r.id) !== String(id));
        writeCache(this.rows);
        return true;
      }
      const res = await sb.from(TABLE).delete().eq('id', id)
        .then((r) => r, () => ({ error: { message: 'rangkaian' } }));
      if (res && res.error) { this.error = 'Gagal buang: ' + (res.error.message || ''); return false; }
      await this.load(sb, range, district);
      return true;
    },
  },
});

export { JKEY, TABLE };
