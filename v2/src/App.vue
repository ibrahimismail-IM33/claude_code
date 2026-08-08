<script setup>
import { ref, computed, onMounted, onBeforeUnmount } from 'vue';
import AppHeader from './components/AppHeader.vue';
import AuthGate from './components/AuthGate.vue';
import MapShell from './components/MapShell.vue';
import DashView from './components/DashView.vue';
import { getClient } from './lib/supabase.js';
import { useAuthStore } from './stores/auth.js';
import { useHydrantsStore, PULL_EVERY } from './stores/hydrants.js';
import { counts as countsOf } from './stores/filters-logic.js';

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
 * Still to come in Phase 5: the Kad Rekod. Tapping a pin currently reports the
 * hydrant and nothing opens — deliberate, and the reason staging cannot yet be
 * anyone's daily driver.
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

// Phase 5 owns the Pengujian scan. Until then every hydrant reads as
// "Belum diperiksa" rather than being guessed at — a wrong figure on a
// dashboard is worse than an honest zero.
const inspStatusOf = () => 'none';
const hasPending = () => false;

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
  await hydrants.pull(sb.value);          // first read fits the map
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
const quiet = () => { if (auth.ready) hydrants.pullFresh(sb.value); };
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
  <div class="app">
    <AppHeader
      :tab="tab" :counts="counts" :status-filter="statusFilter"
      :email="auth.email" :is-admin="auth.isAdmin" :signed-in="auth.ready"
      :clock="clock" :date-now="dateNow"
      @set-tab="(t) => (tab = t)"
      @pick-status="(s) => (statusFilter = s)"
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
        :query="query" :no-fit-once="hydrants.noFitOnce"
        :adding="adding" :is-admin="auth.isAdmin" :draft="draft"
        :saving="saving" :add-error="addError"
        :insp-status-of="inspStatusOf" :has-pending="hasPending"
        @pick-status="(s) => (statusFilter = s)"
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
      :hydrants="hydrants.list" :index="{}"
      :status-filter="statusFilter" :insp-filter="inspFilter" :zone-filter="zoneFilter"
      :period-ix="0" :source="''" :sweep="1"
      :jadual="[]" :jadual-source="''" :is-admin="auth.isAdmin" :cloud-note="''"
      @pick-status="(k) => (inspFilter = inspFilter === k ? null : k)"
      @pick-zone="(z) => { zoneFilter = zoneFilter === z ? null : z; tab = 'map'; }"
    />

    <AuthGate v-if="!auth.ready" :busy="authBusy" :error="authError" @sign-in="signIn" />
  </div>
</template>
