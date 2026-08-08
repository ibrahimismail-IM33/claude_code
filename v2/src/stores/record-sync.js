import { defineStore } from 'pinia';
import { usePendingStore } from './pending.js';
import { planFlush, settle } from './pending-logic.js';
import {
  SEC_ORDER, blankForm, normalizeForm, cardCount, padToCards, formFingerprint,
  upsertRows, deadRows, parkRows, applyCloudRows,
} from './records-logic.js';

/* The record card's cloud round trip.
 *
 * READ CLAUDE.md §4.10, §4.13 and §4.14 BEFORE CHANGING ANYTHING HERE. All
 * three defects lived in these exact paths, all three were found by an officer
 * using the app rather than by review, and two of them destroyed or nearly
 * destroyed field data:
 *
 *   §4.10  A failed save lived only in the form cache, which the next open then
 *          overwrote from the cloud. The typing vanished from the screen AND
 *          the device without ever reaching the server.
 *   §4.13  Clearing a row did nothing. An upsert does not delete what it is not
 *          sent, so the row came back on the next open — for a year.
 *   §4.14  A failed flush dropped the pushed rows from the queue, which is
 *          §4.10 returning on a flaky connection rather than a clean outage.
 *          A FLUSH THAT FAILS MUST CHANGE NOTHING.
 *
 * The order of operations in `open()` is not arbitrary and must not be
 * rearranged for tidiness:
 *
 *   1. FLUSH FIRST. Anything parked from an earlier offline session goes up
 *      before the cloud is read, so the copy we then read already contains it
 *      and there is nothing to warn about. Only genuinely contested rows
 *      survive.
 *   2. READ, and SNAPSHOT the base. `base` is what the cloud held at open time
 *      — the only thing that separates "nobody else touched this" from
 *      "someone changed it after I went offline". Guessing between those two is
 *      what lost the data.
 *   3. OVERWRITE the cache from the cloud. The database is the record; a row an
 *      admin cleared must not linger here and must not be pushed back up.
 *      Safe ONLY because step 1 parked anything unsent.
 */
export const useRecordSyncStore = defineStore('recordSync', {
  state: () => ({
    cloudBase: {},      // hydrant id -> { "section|row_index": data }
    cloudSigned: {},    // hydrant id -> { "section|row_index": true } — permanence, from the server
    lastEdit: null,     // { at, by } — stamped by the database from the JWT
    note: '',           // what to show the officer about the connection
  }),

  actions: {
    // What the cloud held when the card was opened.
    snapCloudBase(id, rows) {
      const m = {}, sg = {};
      (rows || []).forEach((r) => {
        m[r.section + '|' + r.row_index] = r.data || {};
        if (r.signed) sg[r.section + '|' + r.row_index] = true;
      });
      this.cloudBase[id] = m;
      /* MERGED, not replaced — the one place this deliberately differs from V1's
       * snapshot semantics, and it is additive only.
       *
       * `save()` re-snapshots from the rows it just wrote, and a signed row is
       * never in that payload, so a replace would forget which rows are signed.
       * Today that is masked: the base is forgotten too, so `deadRows` skips
       * the row as "cloud never held this". The outcome is right and the reason
       * is an accident — remove the base coincidence and a signed row becomes
       * deletable. Signedness is PERMANENT and can only ever be added, so
       * merging cannot produce a wrong answer in either direction. */
      this.cloudSigned[id] = Object.assign({}, this.cloudSigned[id] || {}, sg);
    },
    // What the CLOUD says is signed, snapshotted at open. Cannot be lost by a
    // UI action the way an in-memory `_signed` flag can — see deadRows().
    signedInCloud(id, sec, ri) {
      const m = this.cloudSigned[id];
      return !!(m && m[sec + '|' + ri]);
    },
    baseFor(id, sec, ri) {
      const m = this.cloudBase[id];
      if (!m) return undefined;                 // never saw the cloud this session
      return m[sec + '|' + ri] || null;         // null = row did not exist yet
    },

    async cloudLoad(sb, id) {
      if (!sb) return null;
      try {
        const res = await sb.from('hydrant_records')
          .select('section,row_index,data,signed,signed_by,signed_at,signature,updated_by,updated_at')
          .eq('hydrant_id', id);
        return (res && !res.error && Array.isArray(res.data)) ? res.data : null;
      } catch (e) { return null; }
    },

    async deleteRows(sb, id, dead) {
      if (!dead.length) return true;
      try {
        const oks = await Promise.all(dead.map(async (d) => {
          try {
            const r = await sb.from('hydrant_records').delete()
              .eq('hydrant_id', id).eq('section', d.section).eq('row_index', d.row_index);
            return !(r && r.error);
          } catch (e) { return false; }
        }));
        return oks.every(Boolean);
      } catch (e) { return false; }
    },

    /* Push what is safe to push. Returns counts so the caller can tell the
     * officer what happened rather than guessing. */
    async flush(sb, id) {
      const pending = usePendingStore();
      const p = pending.load(id);
      if (!p) return { nothing: true };
      if (!sb) return { offline: true };

      let rows;
      try {
        const res = await sb.from('hydrant_records').select('section,row_index,data,signed').eq('hydrant_id', id);
        if (!res || res.error || !Array.isArray(res.data)) return { offline: true };
        rows = res.data;
      } catch (e) { return { offline: true }; }

      const cloud = {};
      rows.forEach((r) => { cloud[r.section + '|' + r.row_index] = { data: r.data || {}, signed: !!r.signed }; });
      const plan = planFlush(p.rows, cloud);

      let okPushed = true, okDropped = true;
      if (plan.push.length) {
        try {
          const res = await sb.from('hydrant_records').upsert(
            plan.push.map((r) => ({ hydrant_id: id, section: r.section, row_index: r.row_index, data: r.data })),
            { onConflict: 'hydrant_id,section,row_index' });
          okPushed = !(res && res.error);
        } catch (e) { okPushed = false; }
      }
      if (plan.drop.length) okDropped = await this.deleteRows(sb, id, plan.drop);

      // §4.14: anything that did not land goes BACK in the queue. A flush that
      // fails must change nothing.
      const left = settle(plan, okPushed, okDropped);
      pending.save(id, left.length ? { t: new Date().toISOString(), rows: left } : null);
      return { pushed: okPushed ? plan.push.length : 0, dropped: okDropped ? plan.drop.length : 0, kept: left.length };
    },

    /* Save. Parks BEFORE the request goes out, so a save that never comes back
     * (tab closed, phone asleep mid-request) is still recoverable. */
    async save(sb, id, f, isAdmin) {
      const pending = usePendingStore();
      const baseFor = (s, i) => this.baseFor(id, s, i);
      const dead = deadRows(f, isAdmin, baseFor, (s, i) => this.signedInCloud(id, s, i));
      const rows = upsertRows(id, f);
      const park = () => pending.save(id, { t: new Date().toISOString(), rows: parkRows(rows, dead, baseFor) });

      if (!sb) { park(); this.note = 'Local only'; return { ok: false, reason: 'cloud not configured' }; }

      park();
      try {
        const res = await sb.from('hydrant_records').upsert(rows, { onConflict: 'hydrant_id,section,row_index' });
        if (res && res.error) { this.note = 'Cloud ERROR · ' + (res.error.message || 'save failed'); return { ok: false, reason: res.error.message || 'save failed' }; }
        const delOk = await this.deleteRows(sb, id, dead);
        if (!delOk) { this.note = 'Cloud ERROR · baris tidak dapat dibuang'; return { ok: false, reason: 'baris tidak dapat dibuang' }; }
        pending.save(id, null);                 // it landed — nothing outstanding
        this.snapCloudBase(id, rows.map((r) => ({ section: r.section, row_index: r.row_index, data: r.data })));
        this.note = 'Cloud connected ✓';
        return { ok: true };
      } catch (e) {
        this.note = 'Cloud ERROR · ' + ((e && e.message) || 'network error');
        return { ok: false, reason: (e && e.message) || 'network error' };
      }
    },

    /* Open a card: flush, read, snapshot, rebuild.
     * `local` is what is already on screen; the returned `form` replaces it
     * ONLY when the record actually differs, because redrawing an identical
     * card reads as a blink on a phone and it was happening on almost every
     * open (CLAUDE.md §3, formFingerprint). */
    async open(sb, id, local) {
      await this.flush(sb, id);
      const rows = await this.cloudLoad(sb, id);
      if (!rows) { this.note = 'Local only'; return { form: local, changed: false, rows: null }; }

      this.snapCloudBase(id, rows);
      const applied = applyCloudRows(blankForm(), rows);
      this.lastEdit = applied.lastEdit;
      const fresh = normalizeForm(applied.form);
      padToCards(fresh, cardCount(fresh));                 // compare like with like
      this.note = 'Cloud connected ✓';
      const changed = formFingerprint(fresh) !== formFingerprint(local);
      return { form: changed ? fresh : local, changed, rows };
    },
  },
});

export { SEC_ORDER };
