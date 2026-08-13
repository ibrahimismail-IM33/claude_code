<script setup>
import { ref, computed, onMounted, onBeforeUnmount } from 'vue';
import AppHeader from './components/AppHeader.vue';
import AuthGate from './components/AuthGate.vue';
import MapShell from './components/MapShell.vue';
import DashView from './components/DashView.vue';
import KadRekod from './components/KadRekod.vue';
import HydrantDetail from './components/HydrantDetail.vue';
import ProfileView from './components/ProfileView.vue';
import { getClient } from './lib/supabase.js';
import { useAuthStore } from './stores/auth.js';
import { useHydrantsStore, PULL_EVERY } from './stores/hydrants.js';
import { useRecordsStore } from './stores/records.js';
import { useRecordSyncStore } from './stores/record-sync.js';
import { useDashboardStore } from './stores/dashboard.js';
import { inspStatusOf as inspStatusFor, halfList, halfRange } from './stores/dashboard-logic.js';
import { usePendingStore } from './stores/pending.js';
import { useJadualStore } from './stores/jadual.js';
import { useProfileStore } from './stores/profile.js';
import { counts as countsOf } from './stores/filters-logic.js';
import { animateSweep } from './lib/dash-anim.js';

/* The app shell.
 *
 * This file replaced a CSP *probe* that had been standing in for it since
 * Phase 0 — every component was proven individually through the test harness
 * while nothing composed them, so the production bundle contained no app at
 * all. Worth remembering: a green suite says the parts work, never that the
 * whole exists.
 *
 * What the shell owns, and why it is here rather than in a component:
 *
 *  - THE SCOPE FILTERS. Awam/Swasta is read by the map AND the dashboard, so
 *    it lives above both. §4.2 was the opposite: the pills sat in the header
 *    and refreshed only the map, so tapping one while the dashboard showed
 *    changed the scope and left every figure unchanged.
 *  - THE SESSION. Nothing below the gate renders until a role is resolved.
 *    Not for security — RLS decides that, evaluated in the database as the
 *    calling role — but because an app rendered before its session exists
 *    reads the register as empty and looks like 187 deleted hydrants.
 *  - THE REFRESH CADENCE. Foreground, focus, online, plus a 60s poll while
 *    visible. A device left open on the counter never fires a foreground
 *    event, which is why the poll exists (§3). Every one of these is a QUIET
 *    pull: it must never re-fit the map.
 *
 * The Kad Rekod opens from a pin. What is wired here is the LOCAL round trip —
 * open, edit, save to localStorage, and grow a new card when the last row of a
 * section is complete. That growth fires on the LOCAL save, not on a successful
 * upload, so an officer with no signal still gets their next card
 * (docs/KAD-REKOD.md §2).
 *
 * The cloud round trip is now wired too, through `record-sync.js`, which is
 * ported line by line and guarded by `tests/v2-record-sync.js`. The order in
 * `open()` matters and is not to be rearranged: FLUSH first, then read, then
 * overwrite the cache. Overwriting is only safe because the flush parked
 * anything unsent — that is the whole of §4.10.
 *
 * Signed links and signature capture are wired too. The links are resolved
 * ALONGSIDE the card rather than before it: making an officer wait on a second
 * round trip to see a record they already have is the wrong trade, so the card
 * paints from cache and the signatures appear when they land.
 */
const SUPABASE_URL = 'https://isxfhocfkjamjchmicwq.supabase.co';
// The PUBLISHABLE key, same one V1 ships in plain sight. It is not a secret:
// it identifies the project and grants nothing on its own — every row is
// gated by RLS, evaluated in the database as the calling role. The service-role
// key must NEVER appear in a bundle. Overridable so a staging build can point
// somewhere else without editing source.
const SUPABASE_KEY = import.meta.env.VITE_SUPABASE_KEY || 'sb_publishable_T3MxpZYRCHWcmlMe4iGgVQ_iz3D7z-_';

const auth = useAuthStore();
const hydrants = useHydrantsStore();
const records = useRecordsStore();
const sync = useRecordSyncStore();
const dash = useDashboardStore();
const pending = usePendingStore();
const jadual = useJadualStore();
const profile = useProfileStore();

const sb = ref(null);
const tab = ref('map');
const statusFilter = ref(null);
const inspFilter = ref(null);
const zoneFilter = ref(null);
const query = ref('');
const adding = ref(false);
const draft = ref(null);
const saving = ref(false);
const addError = ref('');
const authBusy = ref(false);
const authError = ref('');
const clock = ref('--:--:--');
const dateNow = ref('—');

const counts = computed(() => countsOf(hydrants.list));

/* The dashboard's figures, and the map's inspection filter, both derive from
 * the SAME Pengujian rows the record card writes — one source of truth, nothing
 * to drift (CLAUDE.md §2). This was a `() => 'none'` stub for five phases while
 * 68 parity assertions passed over the logic behind it. */
const periodIx = ref(0);
const periods = computed(() => halfList());
const periodRange = computed(() => halfRange(periods.value[periodIx.value]));
const inspStatusOf = (h) => inspStatusFor(dash.index, h, periodRange.value);

/* Fired when the Dashboard TAB IS OPENED, never during map init — the entry
 * animation must not compete with 187 markers loading (CLAUDE.md §6).
 *
 * `sweep` is the animation's PROGRESS, in [0, 1], and it is multiplied straight
 * into every figure the dashboard shows. It is NOT a counter, and it was one
 * once: `sweep.value++` passed 1, 2, 3 … into code expecting a fraction, so the
 * register of 203 was displayed as 1624 on the eighth open and "Belum
 * diperiksa" read 705.4%. The first open gave sweep === 1 and looked perfect,
 * which is why every suite passed and staging looked right.
 *
 * Cancel before re-running: two overlapping animations would write the same
 * value from two rAF loops. The cancel lands on 1, so a figure is never left
 * part-counted. */
const sweep = ref(1);
let cancelSweep = null;
function runSweep() {
  if (cancelSweep) cancelSweep();
  cancelSweep = animateSweep((p) => { sweep.value = p; });
}
function refreshDash() {
  runSweep();
  jadual.load(sb.value, periodRange.value);
  return dash.refresh(sb.value, hydrants.list, (id) => records.load(id));
}

/* The schedule's writes go through the store, then re-read so every device
 * agrees. `by` is the signed-in email, for the created_by column — the row's
 * own audit trail is stamped in the database from the JWT regardless. */
const jadualRange = () => periodRange.value;
async function onJadualAdd(row) {
  await jadual.add(sb.value, jadualRange(), Object.assign({ by: auth.email || null }, row));
}
async function onJadualUpdate(row) { await jadual.update(sb.value, jadualRange(), row); }
async function onJadualDelete(id) { await jadual.remove(sb.value, jadualRange(), id); }
/* V1's `refresh()`, as a signal. Bumped whenever a marker's APPEARANCE changes
 * without the visible SET changing — a saved or cleared inspection date, a
 * pending badge appearing or clearing. Without it the pin kept the old date
 * until a pull or a tab switch rebuilt the list. See MapView's `redraw` prop. */
const mapRedraw = ref(0);
const refreshMap = () => { mapRedraw.value++; };

/* The Save button's state, ported from V1: Saving… → Saved to cloud ✓ / ⚠ Local
 * only → Save. V2's button was a static label, so an officer could not tell a
 * save from a no-op — which on a field connection is the difference between
 * filed and lost. */
const saveState = ref('');
let saveStateTimer = null;

const hasPending = (id) => pending.has(id);

async function signIn({ email, password, clear }) {
  authError.value = '';
  if (!sb.value) { authError.value = 'Cannot reach the server. Check your internet connection.'; return; }
  if (!email || !password) { authError.value = 'Please enter both email and password.'; return; }
  authBusy.value = true;
  try {
    const res = await sb.value.auth.signInWithPassword({ email, password });
    if (res && res.error) {
      const m = (res.error.message || '').toLowerCase();
      // Deliberately vague about WHICH half was wrong — it tells an attacker
      // nothing about whether an account exists. V1 does the same.
      authError.value = m.indexOf('invalid') >= 0 ? 'Wrong email or password.' : (res.error.message || 'Sign in failed.');
      return;
    }
    if (clear) clear();
    await enter();
  } catch (e) {
    authError.value = 'Network error — please try again.';
  } finally {
    authBusy.value = false;
  }
}

async function enter() {
  await auth.enter(sb.value);
  hydrants.loadLocal([]);
  // NOT awaited: the register is what an officer opened the app for, and a
  // profile read is not allowed to sit in front of it. The Sign popup awaits
  // `profile.ready` itself, so a slow read delays that one dialog and nothing
  // else.
  profile.load(sb.value);
  await hydrants.pull(sb.value);          // first read fits the map
}

/* Saving the officer's own signature.
 *
 * The ONE signature in this app that may be replaced — it is a stencil that
 * signRow() COPIES onto a row, never a reference a filed record points at.
 * stores/profile.js carries the full reasoning; docs/KAD-REKOD.md is where the
 * rule is binding.
 */
async function saveProfileSignature(file) {
  if (!sb.value || !file) return;
  await profile.save(sb.value, file);
}

/* Forget the stored signature. Clears the reference only — the image stays in
 * the private bucket, because there is no delete policy and adding one would be
 * adding the very rule that keeps filed signatures permanent. */
async function removeProfileSignature() {
  if (!sb.value) return;
  await profile.remove(sb.value);
}

async function signOut() {
  try { if (sb.value) await sb.value.auth.signOut(); } finally { window.location.reload(); }
}

async function addHydrant(h) {
  if (!sb.value) return;
  saving.value = true; addError.value = '';
  try {
    const res = await sb.value.from('hydrants').insert({
      id: h.id, label: h.label, lat: h.lat, lng: h.lng,
      status: h.status, location: h.location, last_inspected: h.lastInspected || null,
    });
    // The database first, the screen second. A pili that exists on one phone
    // and nowhere else is worse than one that failed loudly.
    if (res && res.error) { addError.value = res.error.message || 'Gagal menyimpan. Sila cuba lagi.'; return; }
    hydrants.list = hydrants.list.concat([h]);
    hydrants.persist();
    adding.value = false; draft.value = null;
  } catch (e) {
    addError.value = 'Gagal menyimpan. Sila cuba lagi.';
  } finally {
    saving.value = false;
  }
}

/* The open card. `openHydrant` non-null IS the open state — there is no second
 * boolean to fall out of step with it. */
const openHydrant = ref(null);
const signing = ref(null);          // {section,row} while the popup is open
const signBusy = ref(false);
const signError = ref('');

/* The hydrant DETAIL modal, which is what a pin tap opens — the card comes
 * second, from a button inside it. V1 does exactly this and V2 shipped wired
 * straight to the card, which read as a shortcut and was a loss: the detail
 * modal is the only place Directions, the coordinates and Last Inspected
 * appear, and Directions is how an officer navigates to a pili in the field. */
const detailHydrant = ref(null);
function openDetail(h) { detailHydrant.value = h; }
function closeDetail() { detailHydrant.value = null; }
function detailOpenCard(h) { detailHydrant.value = null; openCard(h); }

async function openCard(h) {
  // ASSIGN it. `records.load` is a pure reader that RETURNS a form and never
  // sets state — reading `records.form` straight after it threw
  // "Cannot read properties of null", so tapping any pin crashed the app. No
  // suite caught it: the card suites mount the component with a fixture form,
  // the sync suites drive the stores directly, and the shell suite never opened
  // a card. The join between them was covered by nothing.
  records.form = records.load(h.id);
  if (!records.form.header.lokasi && h.location) records.form.header.lokasi = h.location;
  openHydrant.value = h;
  // The card shows the cached copy immediately and catches up when the cloud
  // answers. Making the officer wait on a field connection to see a record
  // they already have is the wrong trade.
  const res = await sync.open(sb.value, h.id, records.form);
  if (res.changed) {
    if (!res.form.header.lokasi && h.location) res.form.header.lokasi = h.location;
    records.form = res.form;
    records.saveLocal(h.id, res.form);
  }
  // A last row completed on ANOTHER device arrives here, not through a
  // keystroke, so the next card has to be offered on open too.
  if (records.needsNewCard(records.form)) records.grow(records.form);
  // Signed links are a separate round trip and the officer must not wait on it.
  await sync.resolveSignatures(sb.value, records.form);
}

/* Signing. Admin-only here AND in RLS — this component's check is courtesy. */
const profileSig = ref('');        // the stencil's BYTES, for the popup preview
const profileSigLoading = ref(false);
let signToken = 0;                 // see startSign — a primitive, deliberately

function startSign(e) {
  if (!auth.isAdmin) return;
  const row = (records.form[e.section] || [])[e.row];
  if (!row || row._signed) return;          // permanence: never offer to re-sign
  signError.value = '';
  signing.value = e;

  /* Fetch the officer's stored signature so the popup opens with the preview
   * already filled — that is the whole point of the Sign button: two taps in
   * the field instead of five.
   *
   * Fetched HERE, on each open, rather than cached when the profile loads. A
   * card can sit open for an hour, and what this produces is copied into a
   * PERMANENT record; a stale copy of a signature the officer has since
   * replaced is exactly the thing that cannot be corrected afterwards.
   *
   * Not awaited by the caller: the popup opens immediately and fills in when
   * this lands, so a slow connection never blocks the dialog. */
  profileSig.value = '';
  profileSigLoading.value = true;
  /* A token, NOT a comparison against `signing.value`.
   *
   * `ref()` deep-converts an object to a reactive PROXY, so `signing.value`
   * is never `===` the object that was assigned to it — a staleness guard
   * written that way is always "stale" and silently throws every result away.
   * That is exactly what happened here, and nothing errored: the popup simply
   * offered to add a signature the officer already had. A counter compares
   * primitives and cannot be proxied. */
  const token = ++signToken;
  (async () => {
    // A profile read still in flight would otherwise report "no signature" and
    // send the officer off to add one they already have.
    if (!profile.ready) await profile.load(sb.value);
    const d = await profile.asDataUrl(sb.value);
    // Discard if the officer closed the popup or moved to another row while
    // this was in flight — the bytes belong to the row that asked for them.
    if (token !== signToken) return;
    profileSig.value = d || '';
    profileSigLoading.value = false;
  })();
}

/* No stored signature: send them where they can add one. The card closes,
 * because Profile is a tab behind it and leaving the overlay up would hide it. */
function signGoProfile() {
  signing.value = null;
  closeCard();
  tab.value = 'profile';
}
async function confirmSign(dataUrl) {
  const h = openHydrant.value;
  if (!h || !signing.value || !dataUrl) return;
  signBusy.value = true; signError.value = '';
  const res = await sync.signRow(sb.value, h.id, records.form,
    signing.value.section, signing.value.row, dataUrl, auth.email);
  signBusy.value = false;
  if (!res.ok) { signError.value = res.reason || 'Gagal.'; return; }
  // Local copy second, and only once the server accepted it. A row marked
  // signed here but not there would look permanent and not be.
  records.saveLocal(h.id, records.form);
  signing.value = null;
}
function closeCard() { openHydrant.value = null; }

function editCell(e) {
  const f = records.form;
  if (!f) return;
  if (e.section === 'header') { f.header[e.key] = e.value; return; }
  const row = (f[e.section] || [])[e.row];
  // A signed row is permanent. The component disables its inputs, RLS refuses
  // the write and a trigger blocks it — this is the fourth place, and it costs
  // one line: never trust that a disabled input stayed disabled.
  if (!row || row._signed) return;
  row[e.key] = e.value;
}

async function saveCard() {
  const h = openHydrant.value;
  if (!h || !records.form) return;
  // LOCAL FIRST, always. The new card and the officer's own copy must not
  // depend on a request succeeding (docs/KAD-REKOD.md §2).
  records.saveLocal(h.id, records.form);
  // Growth is triggered from Save, never from a keystroke: a half-typed row is
  // not a record, and a card conjured by one stray keypress is a card the
  // officer then has to explain (docs/KAD-REKOD.md §2).
  if (records.needsNewCard(records.form)) records.grow(records.form);
  /* Push the card's two outward-facing fields back onto the hydrant, then to
   * the SERVER. V1 does both in `saveForm` via syncLocation + syncLastInspected,
   * each ending in `cloudSave(t)`. V2 updated memory and localStorage only, so
   * neither ever left the device — see stores/hydrants.js `saveOne`.
   *
   * The two rules are ASYMMETRIC and both are deliberate:
   *
   *   Lokasi — a BLANK NEVER OVERWRITES. The Kad Rekod is the address of
   *   record (CLAUDE.md §3) and the popup, registry, search and every dashboard
   *   Lokasi link read `hydrant.location`; an officer clearing the field must
   *   not wipe the registered address.
   *
   *   Last Inspected — a BLANK DOES CLEAR. §3 again: returning early on an
   *   empty date left the map advertising an inspection the record no longer
   *   held, while the dashboard, reading those same rows, said "Belum
   *   diperiksa". The badge follows the Pengujian rows that actually exist. */
  const hy = hydrants.list.find((x) => x.id === h.id);
  if (hy) {
    let changed = false;
    const d = records.lastInspected(records.form);
    if ((hy.lastInspected || '') !== (d || '')) { hy.lastInspected = d || ''; changed = true; }
    const loc = String((records.form.header && records.form.header.lokasi) || '').trim();
    if (loc && hy.location !== loc) { hy.location = loc; changed = true; }
    hydrants.persist();
    if (changed) hydrants.saveOne(sb.value, hy);   // fire and forget, as V1 is
  }
  // The pin's badge follows the rows that now exist — redraw it immediately
  // rather than waiting for the next pull (V1 calls refresh() here).
  refreshMap();

  saveState.value = 'saving';
  if (saveStateTimer) { clearTimeout(saveStateTimer); saveStateTimer = null; }
  const res = await sync.save(sb.value, h.id, records.form, auth.isAdmin);
  saveState.value = (res && res.ok) ? 'ok' : 'local';
  // A parked save shows the amber ! on the pin, so the map has to follow that too.
  refreshMap();
  saveStateTimer = setTimeout(() => { saveState.value = ''; saveStateTimer = null; }, 4000);
}

/* Clicking the ACTIVE pill clears it — V1 does `activeFilter = activeFilter === s
 * ? null : s` (index.html:1562), so a second tap is how an officer gets back to
 * Semua without hunting for the ✕. V2 set it unconditionally and the pill could
 * never be turned off from itself. */
function pickStatus(s) { statusFilter.value = statusFilter.value === s ? null : s; }

function clearFilters() { statusFilter.value = null; inspFilter.value = null; zoneFilter.value = null; }

function tickClock() {
  const o = { timeZone: 'Asia/Kuching' };
  try { clock.value = new Date().toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', second: '2-digit', ...o }); }
  catch (e) { clock.value = new Date().toLocaleTimeString(); }
  try { dateNow.value = new Date().toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric', ...o }); }
  catch (e) { dateNow.value = new Date().toLocaleDateString(); }
}

// Every one of these is a QUIET pull — noFitOnce is armed, so the map records
// the new key without re-fitting. A pull that brings in a hydrant someone else
// added must never jump the view away from what an officer is reading (§3).
/* Anything parked from an earlier offline session goes up automatically when
 * the connection returns — the officer should not have to open every pili to
 * find what has not synced. */
/* Returns a promise so callers can redraw AFTER the flush settles — a pushed
 * row clears the amber `!` on its pin, and that badge has the same staleness
 * problem the date badge had. */
function flushAll() {
  if (!sb.value || !auth.ready) return Promise.resolve();
  return Promise.all(pending.ids().map((id) => sync.flush(sb.value, id)));
}
const quiet = () => {
  if (!auth.ready) return;
  hydrants.pullFresh(sb.value);
  flushAll().then(refreshMap, refreshMap);
};
const onVisible = () => { if (!document.hidden) quiet(); };
let clockTimer = null, pollTimer = null;

onMounted(async () => {
  sb.value = SUPABASE_KEY ? getClient(SUPABASE_URL, SUPABASE_KEY) : null;
  tickClock();
  clockTimer = setInterval(tickClock, 1000);
  // 60s, and NOTHING runs while the tab is hidden — a phone in a pocket must
  // not be polling a field connection. pullFresh throttles to one pull per 10s
  // on top of this, so a burst of focus events cannot stack up.
  pollTimer = setInterval(() => { if (!document.hidden) quiet(); }, PULL_EVERY);
  document.addEventListener('visibilitychange', onVisible);
  window.addEventListener('focus', quiet);
  window.addEventListener('online', quiet);

  // An existing session skips the gate — V1 does the same, and a gate shown to
  // someone already signed in reads as having been signed out.
  try {
    const s = sb.value && await sb.value.auth.getSession();
    if (s && s.data && s.data.session) await enter();
  } catch (e) { /* no session; the gate stays up */ }
});

onBeforeUnmount(() => {
  if (clockTimer) clearInterval(clockTimer);
  if (pollTimer) clearInterval(pollTimer);
  document.removeEventListener('visibilitychange', onVisible);
  window.removeEventListener('focus', quiet);
  window.removeEventListener('online', quiet);
});
</script>

<template>
  <!-- No per-tab ground class any more. Dashboard and Profil used to get
       `bg-alt`, which faded in a rotated copy of the old artwork plus the 50th
       watermark; all three tabs now share one image on `body` (user's call,
       2026-08-13). Nothing to toggle, so nothing to get out of step. -->
  <div class="app">
    <AppHeader
      :tab="tab" :counts="counts" :status-filter="statusFilter"
      :email="auth.email" :is-admin="auth.isAdmin" :signed-in="auth.ready"
      :clock="clock" :date-now="dateNow"
      @set-tab="(t) => { tab = t; if (t === 'dash') refreshDash(); }"
      @pick-status="pickStatus"
      @add="adding = true"
      @sign-out="signOut"
    />

    <!-- Both views stay MOUNTED and are hidden with .hide, exactly as V1 does.
         Destroying the map on every tab switch would re-create 187 markers and
         re-fit the view, so an officer would lose their pan every time they
         glanced at the dashboard. -->
    <div v-show="tab === 'map'" style="display:contents">
      <MapShell
        :hydrants="hydrants.list"
        :status-filter="statusFilter" :insp-filter="inspFilter" :zone-filter="zoneFilter"
        :query="query" :no-fit-once="hydrants.noFitOnce" :redraw="mapRedraw"
        :adding="adding" :is-admin="auth.isAdmin" :draft="draft"
        :active="tab === 'map'"
        :saving="saving" :add-error="addError"
        :insp-status-of="inspStatusOf" :has-pending="hasPending"
        @pick="openDetail"
        @pick-status="pickStatus"
        @clear-filters="clearFilters"
        @search="(v) => (query = v)"
        @pick-lat-lng="(p) => (draft = p)"
        @close-add="() => { adding = false; draft = null; addError = ''; }"
        @add-hydrant="addHydrant"
        @fitted="() => (hydrants.noFitOnce = false)"
      />
    </div>

    <DashView
      v-show="tab === 'dash'"
      :hydrants="hydrants.list" :index="dash.index"
      :status-filter="statusFilter" :insp-filter="inspFilter" :zone-filter="zoneFilter"
      :period-ix="periodIx" :source="dash.source" :sweep="sweep" :active="tab === 'dash'"
      :jadual="jadual.rows" :jadual-source="jadual.source" :jadual-capped="jadual.capped"
      :is-admin="auth.isAdmin" :cloud-note="jadual.error"
      @pick-period="(i) => { periodIx = i; refreshDash(); }"
      @pick-status="(k) => { inspFilter = inspFilter === k ? null : k; tab = 'map'; }"
      @pick-zone="(z) => { zoneFilter = zoneFilter === z ? null : z; tab = 'map'; }"
      @jadual-add="onJadualAdd"
      @jadual-update="onJadualUpdate"
      @jadual-delete="onJadualDelete"
      @jadual-location="(q) => { query = q; tab = 'map'; }"
      @pick-location="(q) => { query = q; tab = 'map'; }"
    />

    <ProfileView
      v-show="tab === 'profile'"
      :email="auth.email" :is-admin="auth.isAdmin"
      :sig-url="profile.url" :has-signature="profile.hasSignature"
      :busy="profile.busy" :error="profile.error"
      :active="tab === 'profile'"
      @pick-signature="saveProfileSignature"
      @remove-signature="removeProfileSignature"
      @sign-out="signOut"
    />

    <HydrantDetail v-if="detailHydrant" :hydrant="detailHydrant"
                   @close="closeDetail" @open-card="detailOpenCard" />

    <KadRekod v-if="openHydrant && records.form"
              :hydrant="openHydrant" :form="records.form" :is-admin="auth.isAdmin"
              :last-edit="sync.lastEdit" :cloud-note="sync.note" :save-state="saveState"
              :signing="signing" :sign-busy="signBusy" :sign-error="signError"
              :profile-sig="profileSig" :profile-sig-loading="profileSigLoading"
              @close="closeCard" @save="saveCard" @edit="editCell"
              @sign="startSign" @sign-cancel="signing = null" @sign-confirm="confirmSign"
              @sign-go-profile="signGoProfile" />

    <AuthGate v-if="!auth.ready" :busy="authBusy" :error="authError" @sign-in="signIn" />
  </div>
</template>
