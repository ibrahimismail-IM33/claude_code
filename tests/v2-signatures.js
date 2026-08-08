/* Phase 5 gate, part 3 — SIGNATURES in V2: signed links, and capture.
 *
 * docs/KAD-REKOD.md §5 is binding, and the sentence that matters most is:
 *
 *   **The signature IS the evidence.** Any change that could make a signed row
 *   writable, or a signature image unreachable, is a correctness failure of the
 *   same severity as losing the record itself.
 *
 * So this suite asserts two families of thing, and neither is cosmetic:
 *
 *  1. **A signed row is permanent.** Signing is irreversible; a second signature
 *     is never offered or accepted; the local copy is only marked signed once
 *     the SERVER accepted it. A row that looks permanent on screen but is not
 *     permanent in the database is the worst outcome available here.
 *  2. **A signature is never silently unreachable.** The bucket is private, so
 *     links are short-lived and resolved per viewing. Rows signed before the
 *     lockdown hold a full public URL instead of a path and must still resolve.
 *     When signing fails, the link expires, or the request errors, the card
 *     must fall back rather than show nothing — a blank T.T on a signed row
 *     reads as the signature having been LOST.
 *
 * Run:  node tests/v2-signatures.js
 */
const path = require('path');

let pass = 0, fail = 0;
const check = (name, got, want) => { const ok = JSON.stringify(got) === JSON.stringify(want);
  console.log((ok ? '  PASS  ' : '  FAIL  ') + name + '  got=' + JSON.stringify(got) + (ok ? '' : '  want=' + JSON.stringify(want)));
  ok ? pass++ : fail++; };

class Store {
  constructor() { this.m = new Map(); }
  getItem(k) { return this.m.has(k) ? this.m.get(k) : null; }
  setItem(k, v) { this.m.set(k, String(v)); }
  removeItem(k) { this.m.delete(k); }
  key(i) { return [...this.m.keys()][i]; }
  get length() { return this.m.size; }
}

/* A Supabase stand-in with storage. `failUpload` and `failUpsert` are separate
 * because the ORDER of those two operations is the thing being guarded: upload
 * first, mark signed only if it worked. */
function makeSb(opts) {
  const o = opts || {};
  const db = [];
  const uploaded = [];
  const signedCalls = [];
  return {
    _db: db, _uploaded: uploaded, _signed: signedCalls, _opts: o,
    storage: {
      from() {
        return {
          upload(p, blob, cfg) {
            if (o.failUpload) return Promise.resolve({ error: { message: 'denied' } });
            if (o.throwUpload) return Promise.reject(new Error('network'));
            uploaded.push({ path: p, upsert: cfg && cfg.upsert, type: cfg && cfg.contentType });
            return Promise.resolve({ error: null, data: { path: p } });
          },
          createSignedUrls(paths, ttl) {
            signedCalls.push({ paths: paths.slice(), ttl });
            if (o.failSign) return Promise.resolve({ error: { message: 'nope' }, data: null });
            if (o.throwSign) return Promise.reject(new Error('offline'));
            return Promise.resolve({
              error: null,
              data: paths.map((p) => ({ [o.altKey ? 'signedURL' : 'signedUrl']: 'https://signed/' + p + '?t=' + (o.tag || 1) })),
            });
          },
        };
      },
    },
    from() {
      return {
        upsert(payload) {
          if (o.failUpsert) return Promise.resolve({ error: { message: 'refused' } });
          db.push(payload);
          return Promise.resolve({ error: null });
        },
        select() { return { eq: () => Promise.resolve({ data: [], error: null }),
                            order: () => ({ range: () => Promise.resolve({ data: [], error: null }) }) }; },
        delete() { return { eq() { return this; }, then(r) { return Promise.resolve({ error: null }).then(r); } }; },
      };
    },
  };
}

(async () => {
  global.window = { localStorage: new Store() };
  global.localStorage = global.window.localStorage;
  global.atob = (b) => Buffer.from(b, 'base64').toString('binary');
  global.Blob = class { constructor(parts, o) { this.parts = parts; this.type = o && o.type; } };

  const { createPinia, setActivePinia } = await import('pinia');
  const RS = await import(path.join('file://', __dirname, '..', 'v2/src/stores/record-sync.js'));
  const L = await import(path.join('file://', __dirname, '..', 'v2/src/stores/records-logic.js'));
  const SL = await import(path.join('file://', __dirname, '..', 'v2/src/lib/signature-links.js'));

  const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';
  const fresh = () => { setActivePinia(createPinia()); SL._resetSigCache(); global.window.localStorage.m.clear(); };

  // ---------- T1: sigPath handles every form a row can hold ----------
  console.log('T1  the durable reference, in every form it has ever been stored');
  check('a plain storage path passes through', SL.sigPath('26/pengujian_2_1712.png'), '26/pengujian_2_1712.png');
  // Rows signed BEFORE the bucket was locked down hold a full public URL. They
  // are permanent and can never be re-uploaded, so this path must keep working.
  check('a legacy PUBLIC url yields its path',
    SL.sigPath('https://x.supabase.co/storage/v1/object/public/signatures/26/pengujian_2_1712.png'),
    '26/pengujian_2_1712.png');
  check('a previously-signed url yields its path too',
    SL.sigPath('https://x.supabase.co/storage/v1/object/sign/signatures/26/a.png?token=zz'),
    '26/a.png');
  check('an encoded path is decoded', SL.sigPath('https://x/storage/v1/object/public/signatures/26/a%20b.png'), '26/a b.png');
  check('an unrelated URL cannot be signed, and says so', SL.sigPath('https://elsewhere/x.png'), '');
  check('empty stays empty', SL.sigPath(''), '');
  check('null does not throw', SL.sigPath(null), '');

  // ---------- T2: resolving links ----------
  console.log('T2  links resolve, cache, and fall back rather than showing nothing');
  fresh();
  let sb = makeSb();
  let f = L.blankForm();
  f.pengujian[0] = Object.assign(L.emptyRow('pengujian'), { _signed: true, _sig: '26/a.png' });
  f.kerosakan[1] = Object.assign(L.emptyRow('kerosakan'), { _signed: true, _sig: '26/b.png' });
  await SL.resolveSigs(sb, f, L.SEC_ORDER);
  check('every signed row got a link',
    [f.pengujian[0]._sigUrl, f.kerosakan[1]._sigUrl],
    ['https://signed/26/a.png?t=1', 'https://signed/26/b.png?t=1']);
  check('one request for both, not one each', sb._signed.length, 1);
  check('and it asked for a 1-hour lifetime', sb._signed[0].ttl, SL.SIG_TTL);

  // Reopening must cost no round trip — the officer sees the signature on the
  // first paint rather than after a flash of placeholder.
  const before = sb._signed.length;
  const f2 = L.blankForm();
  f2.pengujian[0] = Object.assign(L.emptyRow('pengujian'), { _signed: true, _sig: '26/a.png' });
  await SL.resolveSigs(sb, f2, L.SEC_ORDER);
  check('reopening a card reuses the cached link', sb._signed.length, before);
  check('...and still paints it', f2.pengujian[0]._sigUrl, 'https://signed/26/a.png?t=1');

  // Supabase has spelled this key both ways across versions. Accepting only one
  // would resolve nothing and look exactly like a lost signature.
  fresh();
  sb = makeSb({ altKey: true });
  f = L.blankForm();
  f.pengujian[0] = Object.assign(L.emptyRow('pengujian'), { _signed: true, _sig: '26/a.png' });
  await SL.resolveSigs(sb, f, L.SEC_ORDER);
  check('signedURL is accepted as well as signedUrl', f.pengujian[0]._sigUrl, 'https://signed/26/a.png?t=1');

  // ---------- T3: never blank on a signed row ----------
  console.log('T3  a signed row NEVER falls back to nothing');
  for (const [label, opts] of [['the request errors', { failSign: true }], ['the request rejects', { throwSign: true }]]) {
    fresh();
    sb = makeSb(opts);
    f = L.blankForm();
    f.pengujian[0] = Object.assign(L.emptyRow('pengujian'), { _signed: true, _sig: '26/a.png' });
    await SL.resolveSigs(sb, f, L.SEC_ORDER);
    check(label + ' → falls back to the stored value', f.pengujian[0]._sigUrl, '26/a.png');
  }
  // With no backend at all (offline boot) the fallback still applies.
  fresh();
  f = L.blankForm();
  f.pengujian[0] = Object.assign(L.emptyRow('pengujian'), { _signed: true, _sig: '26/a.png' });
  await SL.resolveSigs(null, f, L.SEC_ORDER);
  check('no backend → still falls back', f.pengujian[0]._sigUrl, '26/a.png');

  // An UNSIGNED row must never be given a link — that would draw a signature on
  // a row nobody signed.
  fresh();
  sb = makeSb();
  f = L.blankForm();
  f.pengujian[0] = Object.assign(L.emptyRow('pengujian'), { _sig: '26/a.png' });   // no _signed
  await SL.resolveSigs(sb, f, L.SEC_ORDER);
  check('an unsigned row is never given a signature', f.pengujian[0]._sigUrl, undefined);
  check('and no link was requested for it', sb._signed.length, 0);

  // ---------- T4: signing uploads FIRST, then marks the row ----------
  console.log('T4  the image is uploaded before the row is marked signed');
  fresh();
  sb = makeSb();
  let sync = RS.useRecordSyncStore();
  f = L.blankForm();
  f.pengujian[0].penguji = 'Ismail';
  let res = await sync.signRow(sb, 26, f, 'pengujian', 0, PNG, 'officer@bomba.gov.my');
  check('it succeeded', res.ok, true);
  check('the image went up', sb._uploaded.length, 1);
  check('as a PNG', sb._uploaded[0].type, 'image/png');
  // upsert:false means a path collision errors instead of silently replacing an
  // existing signature. A signature image must never be replaceable.
  check('and refuses to overwrite an existing object', sb._uploaded[0].upsert, false);
  check('the path is namespaced by hydrant, section and row',
    /^26\/pengujian_0_\d+\.png$/.test(sb._uploaded[0].path), true);

  const wrote = sb._db[0];
  check('the row is marked signed on the server', wrote.signed, true);
  check('the signer is recorded', wrote.signed_by, 'officer@bomba.gov.my');
  check('with a timestamp', /^\d{4}-\d{2}-\d{2}T/.test(wrote.signed_at), true);
  // THE PATH is stored, never a public URL: a public URL stops working the
  // moment the bucket is locked down, and the row can never be corrected.
  check('the stored reference is the PATH, not a URL', wrote.signature, sb._uploaded[0].path);
  check('no client-only key leaked into the payload',
    Object.keys(wrote.data).filter((k) => k.charAt(0) === '_'), []);
  check('the row is locked locally too', f.pengujian[0]._signed, true);

  // ---------- T5: a failure must NOT mark the row signed ----------
  console.log('T5  a failed sign leaves the row unsigned — no false evidence');
  for (const [label, opts] of [
    ['the upload is refused', { failUpload: true }],
    ['the upload throws', { throwUpload: true }],
    ['the row write is refused', { failUpsert: true }],
  ]) {
    fresh();
    sb = makeSb(opts);
    sync = RS.useRecordSyncStore();
    f = L.blankForm();
    res = await sync.signRow(sb, 26, f, 'pengujian', 0, PNG, 'a@b.c');
    check(label + ' → reports failure', res.ok, false);
    check(label + ' → and the row is NOT marked signed', !!f.pengujian[0]._signed, false);
  }
  // A refused row-write must not leave the row claiming permanence locally.
  fresh();
  sb = makeSb({ failUpsert: true });
  sync = RS.useRecordSyncStore();
  f = L.blankForm();
  await sync.signRow(sb, 26, f, 'pengujian', 0, PNG, 'a@b.c');
  check('an image uploaded but not recorded leaves no signed row', sb._db.length, 0);

  // ---------- T6: permanence ----------
  console.log('T6  a signed row can never be signed again, or deleted');
  fresh();
  sb = makeSb();
  sync = RS.useRecordSyncStore();
  f = L.blankForm();
  await sync.signRow(sb, 26, f, 'pengujian', 0, PNG, 'a@b.c');
  const uploads = sb._uploaded.length;
  res = await sync.signRow(sb, 26, f, 'pengujian', 0, PNG, 'someone@else');
  check('a second signature is refused', res.ok, false);
  check('and nothing was uploaded for it', sb._uploaded.length, uploads);

  // Signing must also register permanence where a UI action cannot lose it —
  // replacing the row object with a blank one drops `_signed`, and deadRows
  // would then happily issue a DELETE for a signed row.
  check('the server view of signedness is recorded', sync.signedInCloud(26, 'pengujian', 0), true);
  f.pengujian[0] = L.emptyRow('pengujian');            // officer clears the row
  const dead = L.deadRows(f, true, () => ({ penguji: 'x' }), (s, i) => sync.signedInCloud(26, s, i));
  check('a cleared signed row still produces NO delete',
    dead.filter((d) => d.section === 'pengujian' && d.row_index === 0).length, 0);

  // ---------- T7: signing without a backend ----------
  console.log('T7  signing needs the server, and says so');
  fresh();
  sync = RS.useRecordSyncStore();
  f = L.blankForm();
  res = await sync.signRow(null, 26, f, 'pengujian', 0, PNG, 'a@b.c');
  check('offline signing is refused', res.ok, false);
  check('with a message an officer can act on', /sambungan pelayan/.test(res.reason), true);
  check('and the row stays unsigned', !!f.pengujian[0]._signed, false);

  console.log('\n' + pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})();
