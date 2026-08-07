/* The Kad Rekod's shape and growth rules, as pure functions.
 *
 * READ docs/KAD-REKOD.md BEFORE CHANGING ANYTHING HERE. The Kad Rekod is a
 * controlled record under MS ISO 9001:2015 procedure PS-8 PILI BOMBA. Its
 * layout and capacities answer to that procedure, not to this repository, and
 * a mistake here is invisible on screen — it surfaces on paper, at the officer
 * who files the card.
 *
 * Only the column KEYS and the per-card capacities live here. The table markup
 * (`thead`) stays in the view layer, where Phase 5 will deal with it; carrying
 * it into a store would put print HTML somewhere no print test looks.
 *
 * The capacities are not a display preference. They are what fits a real sheet
 * of paper: 22 rows plus roughly 75mm of header and section chrome has to land
 * inside the 259mm usable height of Letter at an 8mm margin. Changing one can
 * silently push a card onto a third sheet.
 */

export const SEC_ORDER = ['kerosakan', 'pemantauan', 'pengujian', 'kompaun'];

export const SECTIONS = {
  kerosakan: { perPage: 11, cols: [
    { k: 'tarikh', t: 'date' }, { k: 'jenis', t: 'text' }, { k: 'cadangan', t: 'text' },
    { k: 'mula', t: 'date' }, { k: 'siap', t: 'date' }, { k: 'kos', t: 'text' },
    { k: 'syarikat', t: 'text' }, { k: 'tt', t: 'sign' }] },
  pemantauan: { perPage: 11, cols: [
    { k: 'tarikh', t: 'date' }, { k: 'kebersihan', t: 'text' }, { k: 'fizikal', t: 'text' },
    { k: 'tt', t: 'sign' }] },
  pengujian: { perPage: 15, cols: [
    { k: 'tarikh', t: 'date' }, { k: 'penguji', t: 'text' }, { k: 'statik', t: 'text' },
    { k: 'semasa', t: 'text' }, { k: 'gpm', t: 'text' }, { k: 'catatan', t: 'text' },
    { k: 'tt', t: 'sign' }] },
  // Two blocks of six on one row, and NO signature column — Kompaun has no T.T
  // and there is no card-level sign-off (docs/KAD-REKOD.md §5). A row may
  // legitimately use only the first block, which is why rowIsComplete does not
  // demand every field.
  kompaun: { perPage: 10, cols: [
    { k: 't1', t: 'date' }, { k: 'm1', t: 'text' }, { k: 's1', t: 'text' },
    { k: 'j1', t: 'text' }, { k: 'n1', t: 'text' }, { k: 'b1', t: 'text' },
    { k: 't2', t: 'date' }, { k: 'm2', t: 'text' }, { k: 's2', t: 'text' },
    { k: 'j2', t: 'text' }, { k: 'n2', t: 'text' }, { k: 'b2', t: 'text' }] },
};

export function emptyRow(sec) {
  const o = {};
  SECTIONS[sec].cols.forEach((c) => { o[c.k] = ''; });
  return o;
}

export function cellFilled(row, c) {
  return !!(row[c.k] && String(row[c.k]).trim() !== '');
}

// "Has anything been typed here" — signature columns do not count as content.
export function rowHasData(sec, row) {
  return SECTIONS[sec].cols.some((c) => c.t !== 'sign' && cellFilled(row, c));
}

/* "Complete" decides when a filled column earns the officer a fresh Kad Rekod.
 *
 * Deliberately NOT "every column": Catatan is often left blank and a Kompaun
 * row may legitimately use only the first of its two blocks, so demanding all
 * of them would leave an officer with a full card and nowhere to write — the
 * worst possible failure for a field app. The first column of every section is
 * the Tarikh, and a record without a date is not a record, so that one is
 * required and one more field must back it up.
 */
export function rowIsComplete(sec, row) {
  const cols = SECTIONS[sec].cols;
  if (!cellFilled(row, cols[0])) return false;
  return cols.some((c, i) => i > 0 && c.t !== 'sign' && cellFilled(row, c));
}

export function blankForm() {
  const f = { header: { lokasi: '', tarikh_pasang: '', no_keahlian: '', tarikh_daftar: '' } };
  SEC_ORDER.forEach((s) => {
    f[s] = [];
    for (let i = 0; i < SECTIONS[s].perPage; i++) f[s].push(emptyRow(s));
  });
  return f;
}

/* One card is one complete 2-page Kad Rekod. Every section always holds an
 * exact multiple of its perPage count, so card N shows rows
 * [N*perPage .. +perPage). Whichever section fills first decides: fifteen
 * Pengujian entries create a new card even though Kompaun still has eight free
 * rows, exactly as a new paper card would. */
export function cardCount(f) {
  let n = 1;
  SEC_ORDER.forEach((s) => {
    const len = (f[s] || []).length, per = SECTIONS[s].perPage;
    n = Math.max(n, Math.ceil(len / per) || 1);
  });
  return n;
}

export function padToCards(f, n) {
  SEC_ORDER.forEach((s) => {
    if (!Array.isArray(f[s])) f[s] = [];
    const want = n * SECTIONS[s].perPage;
    while (f[s].length < want) f[s].push(emptyRow(s));
  });
  return f;
}

/* Signed rows carry their evidence through normalisation untouched. A signed
 * row is permanent — it cannot be edited, cleared or deleted by anyone,
 * including an admin — and that is enforced here, in RLS, and in a database
 * trigger independently. */
export function normalizeForm(f) {
  if (!f.header) f.header = { lokasi: '', tarikh_pasang: '', no_keahlian: '', tarikh_daftar: '' };
  SEC_ORDER.forEach((s) => {
    if (!Array.isArray(f[s])) f[s] = [];
    f[s] = f[s].map((r) => {
      const e = emptyRow(s);
      if (r) {
        for (const k in e) { if (r[k] !== undefined) e[k] = r[k]; }
        if (r.tt !== undefined) e.tt = r.tt;
        if (r._signed) {
          e._signed = true;
          e._sig = r._sig || '';
          e._signedBy = r._signedBy || '';
          e._signedAt = r._signedAt || '';
        }
      }
      return e;
    });
  });
  padToCards(f, cardCount(f));   // always a whole number of 2-page cards
  return f;
}

/* Should a fresh 2-page Kad Rekod be created?
 *
 * When the LAST row of ANY section is complete. Because the sections have
 * different capacities, whichever fills first wins — fifteen Pengujian entries
 * create a new card even though Kompaun still has eight free rows, exactly as a
 * new paper card would.
 *
 * Note it asks for the last row of the ARRAY, not row (cards*perPage - 1).
 * Those are the same only while the form is padded to whole cards, which
 * normalizeForm guarantees — but a ragged form reaching here must behave the
 * way V1 behaves, not the way the padding invariant says it should.
 *
 * This is evaluated on SAVE, not on keystroke: a half-typed row is not a
 * record, and a card conjured by one stray keypress is a card the officer then
 * has to explain. See docs/KAD-REKOD.md §2.
 */
export function needsNewCard(f) {
  return SEC_ORDER.some((s) => {
    const arr = (f && f[s]) || [];
    return !!arr.length && rowIsComplete(s, arr[arr.length - 1]);
  });
}

// The pin's date badge follows the Pengujian rows that actually exist. It
// returns "" once no dated row remains, which CLEARS the badge — returning
// early on a blank used to leave the map advertising an inspection the record
// no longer held while the dashboard, reading the same rows, said "Belum
// diperiksa" (CLAUDE.md §3).
export function latestPengujianDate(f) {
  let best = '';
  ((f && f.pengujian) || []).forEach((r) => {
    const d = r && r.tarikh;
    if (d && d > best) best = d;
  });
  return best;
}

/* Whether the cloud copy differs from what is on screen.
 *
 * The card used to draw twice on every open — once from cache, once from the
 * cloud — which reads as a blink on a phone. The two copies are usually
 * identical, so the second draw was pure flicker. `_sigUrl` is excluded
 * because it is a short-lived signed link resolved per viewing and never
 * persisted; including it would make every comparison differ.
 */
export function formFingerprint(f) {
  if (!f) return '';
  const out = [f.header || {}];
  SEC_ORDER.forEach((s) => {
    (f[s] || []).forEach((r) => {
      const o = {};
      Object.keys(r || {}).forEach((k) => { if (k !== '_sigUrl') o[k] = r[k]; });
      out.push(o);
    });
  });
  try { return JSON.stringify(out); } catch (e) { return String(Math.random()); }
}
