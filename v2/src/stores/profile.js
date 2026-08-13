import { defineStore } from 'pinia';
import { resizeImage, dataUrlToBlob } from '../lib/signature-capture.js';

/* The officer's own signature, held once and reused every time they sign.
 *
 * ── STENCIL, NOT EVIDENCE ────────────────────────────────────────────────
 *
 * This is the ONE signature in the app that may be replaced, and the
 * distinction is load-bearing enough that it is written into
 * docs/KAD-REKOD.md rather than left here:
 *
 *   A FILED ROW's signature is evidence. It is permanent — RLS, a database
 *   trigger and the client all refuse to touch it, and it can never be
 *   re-uploaded (§4.15 is what that constraint costs when a capture goes
 *   wrong).
 *
 *   A PROFILE signature is a stencil. record-sync.signRow() COPIES it into
 *   the row's own object at signaturePath(id, sec, ri) and stores THAT path
 *   on the row. A filed row never points here.
 *
 * That copy is the whole safety property. If a row referenced this object
 * instead, an officer replacing a bad photo would break every record that
 * pointed at it — and those records cannot be corrected, by design.
 *
 * Replacement is done by writing a NEW object each time, never by overwriting:
 * the bucket allows INSERT and nothing else, and that is deliberate. See
 * save() for what happened when this wrote to a fixed path.
 *
 * ── Admin only, and the server already agreed ────────────────────────────
 *
 * No new policy was needed. `admins manage profiles` is already
 * `for all to authenticated using (is_admin())`, which covers an admin
 * writing their own `signature`; a viewer has no update path to profiles at
 * all. Do not "fix" that by adding a self-update rule — that policy is
 * `for all`, so a rule scoped to `auth.uid() = id` would let any viewer write
 * their own `role` in the same statement. The note is in sql/supabase-setup.sql.
 *
 * The bucket is PRIVATE, so the stored value is a PATH and displaying it needs
 * a signed link — same as every other signature in the app.
 */

const SIG_TTL = 3600;

export const useProfileStore = defineStore('profile', {
  state: () => ({
    path: '',        // storage path inside the private `signatures` bucket
    url: '',         // short-lived signed link, for display only — never saved
    ready: false,    // has a load been attempted? (absent ≠ not-yet-known)
    busy: false,
    error: '',
  }),

  getters: {
    // The question SignPopup asks. Deliberately the PATH, not the url: a
    // signed link that failed to mint does not mean the officer has no
    // signature, and offering to "add" one they already have would be wrong.
    hasSignature: (s) => !!s.path,
  },

  actions: {
    async load(sb) {
      this.ready = false;
      if (!sb) { this.ready = true; return ''; }
      try {
        const u = await sb.auth.getUser();
        const user = u && u.data && u.data.user;
        if (!user) { this.ready = true; return ''; }
        const res = await sb.from('profiles').select('signature').eq('id', user.id).single();
        this.path = (res && !res.error && res.data && res.data.signature) || '';
      } catch (e) {
        this.path = '';                 // offline: no signature we can prove
      }
      this.ready = true;
      await this.refreshUrl(sb);
      return this.path;
    },

    /* A display link. Never persisted — it expires, and a stored expiring URL
     * is the mistake docs/KAD-REKOD.md keeps warning about. */
    async refreshUrl(sb) {
      this.url = '';
      if (!sb || !this.path) return '';
      try {
        const res = await sb.storage.from('signatures').createSignedUrl(this.path, SIG_TTL);
        if (res && !res.error && res.data) {
          this.url = res.data.signedUrl || res.data.signedURL || '';
        }
      } catch (e) { /* leave blank; the preview shows nothing rather than a dead image */ }
      return this.url;
    },

    /* Take a photo and make it the officer's signature.
     *
     * Same keying and the same 600px cap as signing a row, because the image
     * this produces is EXACTLY what will be copied onto a record — a stencil
     * processed differently from the thing it becomes would be a trap.
     */
    async save(sb, file) {
      this.error = '';
      if (!sb) { this.error = 'Perlu sambungan pelayan.'; return { ok: false }; }
      this.busy = true;
      try {
        const durl = await resizeImage(file, 600);
        if (!durl) { this.error = 'Gambar tidak boleh diproses.'; return { ok: false }; }

        const u = await sb.auth.getUser();
        const user = u && u.data && u.data.user;
        if (!user) { this.error = 'Sesi tamat. Sila log masuk semula.'; return { ok: false }; }

        /* A NEW PATH EVERY TIME, and `upsert: false`.
         *
         * The bucket has exactly one write rule — INSERT — and deliberately no
         * UPDATE and no DELETE, because that absence is what makes a filed
         * record's signature permanent. An earlier version of this wrote to a
         * FIXED path with `upsert: true`, which is an UPDATE the second time
         * round: the first signature saved fine and every replacement failed
         * with "new row violates row-level security policy". The comment here
         * said "replacement IS the feature" and was never checked against the
         * policy sitting in sql/supabase-records-setup.sql.
         *
         * Timestamping the path makes every save an INSERT, so replacement
         * works without loosening the bucket by one line. `upsert: false` for
         * the same reason it is right in signRow(): a collision should be an
         * error — and with a timestamp in the name, a collision means
         * something is badly wrong.
         *
         * THE COST, stated: the previous image stays in the bucket,
         * unreferenced and undeletable from the app. ~120 KB per replacement.
         * CLAUDE.md §7 carries it as a watch item. */
        const path = 'profile/' + user.id + '_' + Date.now() + '.png';
        const up = await sb.storage.from('signatures')
          .upload(path, dataUrlToBlob(durl), { contentType: 'image/png', upsert: false });
        if (up && up.error) { this.error = 'Muat naik gagal: ' + (up.error.message || ''); return { ok: false }; }

        // Order matters, as it does in signRow: the image exists before
        // anything claims it does. The reverse would leave a profile pointing
        // at nothing, and the popup would then pre-fill a broken preview.
        const res = await sb.from('profiles').update({ signature: path }).eq('id', user.id);
        if (res && res.error) { this.error = 'Simpan gagal: ' + (res.error.message || ''); return { ok: false }; }

        this.path = path;
        await this.refreshUrl(sb);
        return { ok: true };
      } catch (e) {
        this.error = 'Muat naik gagal (rangkaian).';
        return { ok: false };
      } finally {
        this.busy = false;
      }
    },

    /* The bytes the Sign popup pre-fills with.
     *
     * Fetched fresh rather than cached as a data URL, because a card left open
     * for an hour would otherwise hold a stale copy of a signature the officer
     * has since replaced — and the copy is what gets filed permanently.
     */
    async asDataUrl(sb) {
      if (!this.path) return '';
      const url = this.url || await this.refreshUrl(sb);
      if (!url) return '';
      try {
        const r = await fetch(url);
        if (!r.ok) return '';
        const blob = await r.blob();
        return await new Promise((resolve) => {
          const fr = new FileReader();
          fr.onload = () => resolve(String(fr.result || ''));
          fr.onerror = () => resolve('');
          fr.readAsDataURL(blob);
        });
      } catch (e) { return ''; }
    },

    /* Forget the officer's signature.
     *
     * Clears the REFERENCE only — `profiles.signature` goes null and Sign stops
     * pre-filling. The image itself stays in the bucket: there is no delete
     * policy, by design, and adding one to tidy up here would be adding the
     * exact rule that keeps filed signatures permanent (user's call,
     * 2026-08-13).
     *
     * Nothing already filed is affected. A signed row holds its own copy at its
     * own path — that is the whole reason this is safe.
     */
    async remove(sb) {
      this.error = '';
      if (!sb) { this.error = 'Perlu sambungan pelayan.'; return { ok: false }; }
      this.busy = true;
      try {
        const u = await sb.auth.getUser();
        const user = u && u.data && u.data.user;
        if (!user) { this.error = 'Sesi tamat. Sila log masuk semula.'; return { ok: false }; }
        const res = await sb.from('profiles').update({ signature: null }).eq('id', user.id);
        if (res && res.error) { this.error = 'Gagal membuang: ' + (res.error.message || ''); return { ok: false }; }
        this.path = ''; this.url = '';
        return { ok: true };
      } catch (e) {
        this.error = 'Gagal membuang (rangkaian).';
        return { ok: false };
      } finally {
        this.busy = false;
      }
    },

    reset() {
      this.path = ''; this.url = ''; this.ready = false; this.busy = false; this.error = '';
    },
  },
});
