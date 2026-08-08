<script setup>
import { ref, onMounted, onBeforeUnmount } from 'vue';
import Pills from './Pills.vue';
// Extracted from V1's inline data: URI. assetsInlineLimit is 0, so Vite emits
// it as a real file served from this origin — img-src 'self' covers it, and it
// leaves the HTML smaller than V1's rather than larger.
import logo from '../assets/logo.png';

/* The header: brand, tabs, scope pills, account state, and the phone menu.
 *
 * Three things here are decisions rather than layout, and all three have
 * already gone wrong once:
 *
 *  - THE PILLS LIVE HERE, not inside the map. They can be tapped while the
 *    DASHBOARD is showing, which is exactly what §4.2 was: their handler
 *    refreshed the map and never touched the dashboard, so the scope changed
 *    while the figures sat there unchanged. Scope is emitted upward and both
 *    views read it — there is no second copy to drift.
 *  - `header{z-index:1000}` forms a stacking context, and the account menu
 *    must escape `.searchrow` (500). §4.8. The number is in shell.css; do not
 *    lower it.
 *  - The hamburger's items STAND IN for buttons that are `display:none` on a
 *    phone, and they emit directly rather than forwarding a click to the
 *    hidden one. (Programmatic `.click()` does fire on a hidden element, so
 *    delegation would happen to work — it is avoided because it makes the
 *    phone path depend on a desktop-only element continuing to exist, which
 *    nothing would catch if it stopped.)
 *
 * The mobile kicker shows "BBP KUNAK" only. The full string is ~200px and
 * forced an extra header row; the short form costs nothing (§3).
 */
const props = defineProps({
  tab: { type: String, default: 'map' },
  counts: { type: Object, required: true },
  statusFilter: { type: String, default: null },
  email: { type: String, default: '' },
  isAdmin: { type: Boolean, default: false },
  signedIn: { type: Boolean, default: false },
  clock: { type: String, default: '--:--:--' },
  dateNow: { type: String, default: '—' },
});
const emit = defineEmits(['setTab', 'pickStatus', 'add', 'signOut']);

const menuOpen = ref(false);
const root = ref(null);

// A menu that only closes by its own button is a menu that gets left open on a
// phone, covering the map.
function onDocClick(e) {
  if (!menuOpen.value) return;
  if (root.value && !root.value.contains(e.target)) menuOpen.value = false;
}
function onKey(e) { if (e.key === 'Escape') menuOpen.value = false; }

onMounted(() => {
  document.addEventListener('click', onDocClick);
  document.addEventListener('keydown', onKey);
});
onBeforeUnmount(() => {
  document.removeEventListener('click', onDocClick);
  document.removeEventListener('keydown', onKey);
});

function pick(t) { emit('setTab', t); menuOpen.value = false; }
function menuAdd() { menuOpen.value = false; emit('add'); }
function menuSignOut() { menuOpen.value = false; emit('signOut'); }
</script>

<template>
  <header ref="root">
    <div class="hrow">
      <div class="brand">
        <span class="bar"></span>
        <div class="logo"><img :src="logo" alt="Jabatan Bomba dan Penyelamat Malaysia"></div>
        <div>
          <!-- .kx is dropped at 640px: the full string is ~200px and pushed the
               tabs onto a row of their own, costing a line of map (§3). -->
          <div class="kicker">BBP Kunak<span class="kx"> · Sabah · Bomba Malaysia</span></div>
          <h1 class="disp" style="font-size:20px;font-weight:800;color:#fff;line-height:1.1">e-Pili Bomba</h1>
        </div>
      </div>

      <div class="divider"></div>

      <div class="tabs" role="tablist" aria-label="Paparan">
        <button class="tabb" :class="{ on: tab === 'map' }" id="tabMap" data-tab="map"
                role="tab" :aria-selected="String(tab === 'map')" @click="pick('map')">Peta Pili</button>
        <button class="tabb" :class="{ on: tab === 'dash' }" id="tabDash" data-tab="dash"
                role="tab" :aria-selected="String(tab === 'dash')" @click="pick('dash')">Dashboard</button>
      </div>

      <Pills :counts="counts" :active="statusFilter"
             @pick="(s) => emit('pickStatus', s)" @clear="emit('pickStatus', null)" />

      <div class="hright">
        <button class="addbtn" id="headerAdd" :class="{ 'ro-hidden': !isAdmin }" @click="emit('add')">
          <span style="font-size:16px;line-height:1">+</span> Tambah Pili
        </button>
        <div class="clock"><span class="u">DATE</span><span class="t" id="dateNow">{{ dateNow }}</span></div>
        <div class="clock"><span class="u">MYT</span><span class="t" id="clock">{{ clock }}</span></div>
        <div class="live"><span class="d soft-pulse"></span><span class="l">Live</span></div>
        <div class="rolebadge" :class="{ hide: !signedIn, admin: isAdmin }" id="roleBadge">
          <span class="r" id="roleTxt">{{ isAdmin ? 'Admin' : 'Viewer' }}</span>
        </div>
        <button class="signout" :class="{ hide: !signedIn }" id="signOutBtn" @click="emit('signOut')">Sign out</button>
      </div>

      <!-- phones only: the account + action controls collapse in here -->
      <button class="menubtn" :class="{ open: menuOpen }" id="menuBtn" aria-label="Menu"
              :aria-expanded="String(menuOpen)" aria-controls="menuPanel"
              @click="menuOpen = !menuOpen">
        <span></span><span></span><span></span>
      </button>
      <div class="menupanel" :class="{ hide: !menuOpen }" id="menuPanel" role="menu" aria-labelledby="menuBtn">
        <div class="mrow mid"><span class="mlab">Email</span><span class="mval" id="mEmail">{{ email || '—' }}</span></div>
        <div class="mrow mid"><span class="mlab">Peranan</span><span class="mval" id="mRole">{{ isAdmin ? 'Admin' : 'Viewer' }}</span></div>
        <button class="mitem" :class="{ 'ro-hidden': !isAdmin }" id="mAdd" role="menuitem" @click="menuAdd">
          <span class="mi">+</span> Tambah Pili
        </button>
        <button class="mitem danger" id="mSignOut" role="menuitem" @click="menuSignOut">Sign out</button>
      </div>
    </div>
  </header>
</template>
