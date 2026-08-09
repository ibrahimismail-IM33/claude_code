/* Phase 5 gate, part 2 — the record card's CLOUD ROUND TRIP in V2.
 *
 * This is the V2 counterpart of `p0-offline-sync.js` and `clear-row.js`, and it
 * exists because those two test V1's `index.html` and nothing was watching the
 * same behaviour in V2. Every serious data-loss defect this app has had lives
 * in these paths:
 *
 *   §4.10  A failed save lived only in the form cache, which the next open then
 *          overwrote from the cloud. An officer's typing vanished from the
 *          screen AND the device without ever reaching the server. Reproduced
 *          end to end; found in the field, not by review.
 *   §4.13  Clearing a row did nothing — an upsert does not delete what it is
 *          not sent, so the row came back on the next open. For a year. On a
 *          legal record an entry that cannot be withdrawn is worse than one
 *          that is missing.
 *   §4.14  A failed flush dropped the pushed rows from the queue, which is
 *          §4.10 returning on a flaky connection instead of a clean outage —
 *          the more common case in the field.
 *
 * Driven through the real Pinia stores against a fake Supabase that can be
 * switched offline, made to fail, or edited "by the office" between calls. The
 * offline branches are the whole point and a real server cannot exercise them.
 *
 * Run:  node tests/v2-record-sync.js
 */
const path = require('path');

let pass = 0, fail = 0;
const check = (name, got, want) => { const ok = JSON.stringify(got) === JSON.stringify(want);
  console.log((ok ? '  PASS  ' : '  FAIL  ') + name + '  got=' + JSON.stringify(got) + (ok ? '' : '  want=' + JSON.stringify(want)));
  ok ? pass++ : fail++; };

// ---- a localStorage that behaves like the real one -------------------------
class Store {
  constructor() { this.m = new Map(); }
  getItem(k) { return this.m.has(k) ? this.m.get(k) : null; }
  setItem(k, v) { this.m.set(k, String(v)); }
  removeItem(k) { this.m.delete(k); }
  key(i) { return [...this.m.keys()][i]; }
  get length() { return this.m.size; }
}

/* A Supabase stand-in that records what it was ASKED to do.
 *
 * `offline` makes every call reject, exactly as a dead connection does — not
 * return an error object, which is a different path. `failUpsert` returns an
 * error object instead, which is the §4.14 case: the request arrives and the
 * server refuses it. The two are deliberately separate. */
function makeSb(rows, opts) {
  const o = opts || {};
  const db = rows.slice();
  const calls = { upsert: 0, delete: 0, select: 0 };
  const die = () => Promise.reject(new Error('offline'));
  const api = {
    _db: db, _calls: calls, _opts: o,
    from() {
      return {
        select() {
          calls.select++;
          const q = { _eq: {},
            eq(k, v) { this._eq[k] = v; return this; },
            then(res, rej) {
              if (o.offline) return die().then(res, rej);
              return Promise.resolve({ data: db.slice(), error: null }).then(res, rej);
            } };
          return q;
        },
        upsert(payload) {
          calls.upsert++;
          if (o.offline) return die();
          if (o.failUpsert) return Promise.resolve({ error: { message: 'refused' } });
          payload.forEach((r) => {
            const i = db.findIndex((x) => x.section === r.section && x.row_index === r.row_index);
            if (i >= 0) db[i] = Object.assign({}, db[i], { data: r.data });
            else db.push({ hydrant_id: r.hydrant_id, section: r.section, row_index: r.row_index, data: r.data, signed: false });
          });
          return Promise.resolve({ error: null });
        },
        delete() {
          calls.delete++;
          const q = { _eq: {},
            eq(k, v) { this._eq[k] = v; return this; },
            then(res, rej) {
              if (o.offline) return die().then(res, rej);
              if (o.failDelete) return Promise.resolve({ error: { message: 'refused' } }).then(res, rej);
              const i = db.findIndex((x) => x.section === this._eq.section && x.row_index === this._eq.row_index);
              if (i >= 0) db.splice(i, 1);
              return Promise.resolve({ error: null }).then(res, rej);
            } };
          return q;
        },
      };
    },
  };
  return api;
}

const rowOf = (sec, i, data, signed) => ({ hydrant_id: 1, section: sec, row_index: i, data, signed: !!signed });
const PENG = (penguji) => ({ tarikh: '', penguji, statik: '', semasa: '', gpm: '', catatan: '', tt: '' });
const cellOf = (f) => f.pengujian[0].penguji;
/* Count PENGUJIAN rows, never `_db.length`. Every save also writes the header
 * row, so the raw length is one higher than the row count and reads as a
 * phantom leftover. Four assertions here were written against the raw length
 * and failed against correct code. */
const pengCount = (sb) => sb._db.filter((x) => x.section === 'pengujian').length;

(async () => {
  global.window = { localStorage: new Store() };
  global.localStorage = global.window.localStorage;

  const { createPinia, setActivePinia } = await import('pinia');
  const RS = await import(path.join('file://', __dirname, '..', 'v2/src/stores/record-sync.js'));
  const P = await import(path.join('file://', __dirname, '..', 'v2/src/stores/pending.js'));
  const L = await import(path.join('file://', __dirname, '..', 'v2/src/stores/records-logic.js'));

  const fresh = () => { setActivePinia(createPinia()); };
  const pendKey = 'bbpkunak_pending_1';

  // ---------- T1: an offline edit survives and reaches the server ----------
  console.log('T1  offline edit survives, and reaches the server when signal returns');
  fresh();
  global.window.localStorage.m.clear();
  let sync = RS.useRecordSyncStore(), pend = P.usePendingStore();
  let sb = makeSb([rowOf('pengujian', 0, PENG('ASAL'))]);

  let opened = await sync.open(sb, 1, L.blankForm());
  check('the card opens from the cloud', cellOf(opened.form), 'ASAL');

  sb._opts.offline = true;                     // signal goes
  let f = opened.form;
  f.pengujian[0].penguji = 'DATA LAPANGAN';
  let r = await sync.save(sb, 1, f, true);
  check('the save reports it did not land', r.ok, false);
  check('and the typing is PARKED, not merely in the form cache',
    !!global.window.localStorage.getItem(pendKey), true);

  sb._opts.offline = false;                    // signal returns
  opened = await sync.open(sb, 1, L.blankForm());
  check('the typing is on screen after reopening', cellOf(opened.form), 'DATA LAPANGAN');
  check('...and it reached the server', sb._db.find((x) => x.section === 'pengujian' && x.row_index === 0).data.penguji, 'DATA LAPANGAN');
  check('the queue is empty again', global.window.localStorage.getItem(pendKey), null);

  // ---------- T2: a contested row — cloud wins, officer warned ----------
  console.log('T2  the office edited the same row meanwhile');
  fresh(); global.window.localStorage.m.clear();
  sync = RS.useRecordSyncStore(); pend = P.usePendingStore();
  sb = makeSb([rowOf('pengujian', 0, PENG('ASAL'))]);
  opened = await sync.open(sb, 1, L.blankForm());     // base = ASAL

  sb._opts.offline = true;
  f = opened.form;
  f.pengujian[0].penguji = 'TAIP DI LAPANGAN';
  await sync.save(sb, 1, f, true);

  sb._opts.offline = false;
  sb._db[0].data.penguji = 'DIUBAH DI PEJABAT';       // the office changes it
  opened = await sync.open(sb, 1, L.blankForm());
  check('the CLOUD version is shown', cellOf(opened.form), 'DIUBAH DI PEJABAT');
  check('the cloud was NOT overwritten', sb._db[0].data.penguji, 'DIUBAH DI PEJABAT');
  const kept = pend.load(1);
  check('the officer keeps a copy of what they typed', !!kept, true);
  check('...and it says exactly what it was',
    kept && kept.rows.some((x) => x.data && x.data.penguji === 'TAIP DI LAPANGAN'), true);

  // ---------- T3: a signed row is never overwritten ----------
  console.log('T3  a row signed elsewhere is never touched');
  fresh(); global.window.localStorage.m.clear();
  sync = RS.useRecordSyncStore(); pend = P.usePendingStore();
  sb = makeSb([rowOf('pengujian', 0, PENG('ASAL'))]);
  opened = await sync.open(sb, 1, L.blankForm());

  sb._opts.offline = true;
  f = opened.form;
  f.pengujian[0].penguji = 'TAIP DI LAPANGAN';
  await sync.save(sb, 1, f, true);

  sb._opts.offline = false;
  sb._db[0].signed = true;                            // signed on another device
  sb._db[0].data.penguji = 'DITANDATANGAN';
  await sync.open(sb, 1, L.blankForm());
  check('a signed row keeps its own content', sb._db[0].data.penguji, 'DITANDATANGAN');
  check('and the parked row is held back rather than pushed', !!pend.load(1), true);

  // A signed row must never even be OFFERED to the server.
  fresh(); global.window.localStorage.m.clear();
  sync = RS.useRecordSyncStore();
  sb = makeSb([]);
  f = L.blankForm();
  f.pengujian[0] = Object.assign(L.emptyRow('pengujian'), { penguji: 'SUDAH', _signed: true, _sig: 'p.png' });
  f.pengujian[1].penguji = 'BOLEH';
  await sync.save(sb, 1, f, true);
  check('a signed row is not in the upsert payload at all',
    sb._db.filter((x) => x.section === 'pengujian').map((x) => x.row_index), [1]);

  // ---------- T4: clearing a row actually DELETES it (§4.13) ----------
  console.log('T4  clearing a row sends a DELETE — an upsert would leave it there');
  fresh(); global.window.localStorage.m.clear();
  sync = RS.useRecordSyncStore();
  sb = makeSb([rowOf('pengujian', 0, PENG('ASAL')), rowOf('pengujian', 1, PENG('KEKAL'))]);
  opened = await sync.open(sb, 1, L.blankForm());
  f = opened.form;
  f.pengujian[0] = L.emptyRow('pengujian');           // the officer clears it
  const before = sb._calls.delete;
  r = await sync.save(sb, 1, f, true);
  check('the save succeeded', r.ok, true);
  check('a DELETE was actually issued', sb._calls.delete > before, true);
  check('the row is GONE from the server, not blanked',
    sb._db.filter((x) => x.section === 'pengujian').map((x) => x.row_index), [1]);
  opened = await sync.open(sb, 1, L.blankForm());
  check('and it does not come back on the next open', cellOf(opened.form), '');
  check('the untouched row is still there', opened.form.pengujian[1].penguji, 'KEKAL');

  // ---------- T5: a signed row is never deleted, by anyone ----------
  console.log('T5  a signed row is never deleted — not even by an admin');
  fresh(); global.window.localStorage.m.clear();
  sync = RS.useRecordSyncStore();
  sb = makeSb([rowOf('pengujian', 0, PENG('SUDAH'), true)]);
  opened = await sync.open(sb, 1, L.blankForm());
  f = opened.form;
  check('the card knows it is signed', !!f.pengujian[0]._signed, true);
  f.pengujian[0] = L.emptyRow('pengujian');           // try to clear it anyway
  await sync.save(sb, 1, f, true);
  check('the signed row survives on the server', pengCount(sb), 1);

  /* And it must still hold AFTER an ordinary save. `save` re-snapshots the base
   * from the rows it just wrote — and a signed row is never in that payload, so
   * a naive re-snapshot forgets which rows were signed and the NEXT clear
   * deletes one. Two saves, not one, is what exposes it. */
  fresh(); global.window.localStorage.m.clear();
  sync = RS.useRecordSyncStore();
  sb = makeSb([rowOf('pengujian', 0, PENG('SUDAH'), true), rowOf('pengujian', 1, PENG('BIASA'))]);
  opened = await sync.open(sb, 1, L.blankForm());
  f = opened.form;
  f.pengujian[2].penguji = 'BARU';                    // an ordinary edit first
  await sync.save(sb, 1, f, true);
  f.pengujian[0] = L.emptyRow('pengujian');           // now try to clear the signed row
  await sync.save(sb, 1, f, true);
  check('permanence survives a preceding save',
    sb._db.some((x) => x.section === 'pengujian' && x.row_index === 0), true);

  // A VIEWER must never park a delete either: RLS would refuse it, and a queue
  // full of deletes that can never land is a queue that never empties.
  fresh(); global.window.localStorage.m.clear();
  sync = RS.useRecordSyncStore();
  sb = makeSb([rowOf('pengujian', 0, PENG('ASAL'))]);
  opened = await sync.open(sb, 1, L.blankForm());
  f = opened.form;
  f.pengujian[0] = L.emptyRow('pengujian');
  await sync.save(sb, 1, f, false);                   // isAdmin = false
  check('a viewer never issues a delete', pengCount(sb), 1);

  // ---------- T6: clearing offline, and a contested removal ----------
  console.log('T6  a clear made offline still reaches the server');
  fresh(); global.window.localStorage.m.clear();
  sync = RS.useRecordSyncStore();
  sb = makeSb([rowOf('pengujian', 0, PENG('ASAL'))]);
  opened = await sync.open(sb, 1, L.blankForm());
  sb._opts.offline = true;
  f = opened.form;
  f.pengujian[0] = L.emptyRow('pengujian');
  await sync.save(sb, 1, f, true);
  check('the removal is parked as an explicit marker',
    (P.usePendingStore().load(1) || { rows: [] }).rows.some((x) => x.removed), true);
  sb._opts.offline = false;
  await sync.open(sb, 1, L.blankForm());
  check('and the row is deleted once the signal returns', pengCount(sb), 0);

  // Someone else edited it before the clear synced: the cloud wins and the
  // officer is told, rather than the row being removed under them.
  fresh(); global.window.localStorage.m.clear();
  sync = RS.useRecordSyncStore();
  sb = makeSb([rowOf('pengujian', 0, PENG('ASAL'))]);
  opened = await sync.open(sb, 1, L.blankForm());
  sb._opts.offline = true;
  f = opened.form;
  f.pengujian[0] = L.emptyRow('pengujian');
  await sync.save(sb, 1, f, true);
  sb._opts.offline = false;
  sb._db[0].data.penguji = 'DIUBAH DI PEJABAT';
  await sync.open(sb, 1, L.blankForm());
  check('a contested removal does NOT delete the row', pengCount(sb), 1);
  check('and the officer is warned', !!P.usePendingStore().load(1), true);

  // ---------- T7: §4.14 — a failed flush must change NOTHING ----------
  console.log('T7  a flush that fails changes nothing (§4.14)');
  fresh(); global.window.localStorage.m.clear();
  sync = RS.useRecordSyncStore();
  sb = makeSb([]);
  sb._opts.offline = true;
  f = L.blankForm();
  f.pengujian[0].penguji = 'DATA LAPANGAN';
  await sync.save(sb, 1, f, true);
  const parked = JSON.parse(global.window.localStorage.getItem(pendKey));
  check('the work is parked', parked.rows.length > 0, true);

  // Signal returns, but the server refuses the write. This is the flaky
  // connection, NOT a clean outage — and it is the case that lost data.
  sb._opts.offline = false;
  sb._opts.failUpsert = true;
  await sync.flush(sb, 1);
  const after = JSON.parse(global.window.localStorage.getItem(pendKey) || 'null');
  check('the parked work is STILL parked after a failed push', !!after, true);
  check('...with nothing dropped from the queue',
    after && after.rows.length, parked.rows.length);
  check('and nothing reached the server', pengCount(sb), 0);

  // Once the server accepts it, it lands and the queue empties.
  sb._opts.failUpsert = false;
  await sync.flush(sb, 1);
  check('it goes up on the next attempt', pengCount(sb) > 0, true);
  check('and only then is the queue cleared', global.window.localStorage.getItem(pendKey), null);

  // A failed DELETE is the same rule.
  fresh(); global.window.localStorage.m.clear();
  sync = RS.useRecordSyncStore();
  sb = makeSb([rowOf('pengujian', 0, PENG('ASAL'))]);
  opened = await sync.open(sb, 1, L.blankForm());
  sb._opts.offline = true;
  f = opened.form;
  f.pengujian[0] = L.emptyRow('pengujian');
  await sync.save(sb, 1, f, true);
  sb._opts.offline = false;
  sb._opts.failDelete = true;
  await sync.flush(sb, 1);
  check('a failed delete keeps the removal parked', !!P.usePendingStore().load(1), true);
  check('and the row is untouched on the server', pengCount(sb), 1);

  // ---------- T8: the cache is only overwritten because parking happened ----------
  console.log('T8  the cloud overwrites the cache — safe ONLY because the flush ran first');
  fresh(); global.window.localStorage.m.clear();
  sync = RS.useRecordSyncStore();
  sb = makeSb([rowOf('pengujian', 0, PENG('ASAL'))]);
  opened = await sync.open(sb, 1, L.blankForm());
  check('an identical card is NOT redrawn — that blink was on every open',
    (await sync.open(sb, 1, opened.form)).changed, false);
  sb._db[0].data.penguji = 'BERUBAH';
  check('but a card that really differs IS redrawn',
    (await sync.open(sb, 1, opened.form)).changed, true);

  // With the cloud unreadable, the local copy must be kept as-is. Rebuilding
  // from an empty read would look exactly like every row having been deleted.
  sb._opts.offline = true;
  const localCopy = opened.form;
  const res = await sync.open(sb, 1, localCopy);
  check('an unreadable cloud keeps the local card, it does not blank it',
    cellOf(res.form), cellOf(localCopy));
  check('and says so rather than claiming to be in sync', sync.note, 'Local only');

  console.log('\n' + pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})();
