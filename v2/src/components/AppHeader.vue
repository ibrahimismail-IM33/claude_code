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
    <!-- The tab bar, pinned across the top (redesign mockup, 2026-08-10).
         It sits OUTSIDE .hrow so it can span the full width; .hrow keeps the
         brand, pills and account controls below it.
         Still `.tabs`, deliberately: below 640px shell.css hides this whole bar
         and the hamburger is the navigation, and T22 asserts exactly that
         selector both ways — visible at 1280, hidden at 360. Renaming it here
         would take navigation away from every phone with nothing to catch it. -->
    <div class="tabs" role="tablist" aria-label="Paparan">
      <button class="tabb" :class="{ on: tab === 'map' }" id="tabMap" data-tab="map"
              role="tab" :aria-selected="String(tab === 'map')" @click="pick('map')">
        <span class="ti" aria-hidden="true">🗺️</span> Peta Pili
      </button>
      <button class="tabb" :class="{ on: tab === 'dash' }" id="tabDash" data-tab="dash"
              role="tab" :aria-selected="String(tab === 'dash')" @click="pick('dash')">
        <span class="ti" aria-hidden="true">📊</span> Dashboard
      </button>
      <button class="tabb" :class="{ on: tab === 'profile' }" id="tabProfile" data-tab="profile"
              role="tab" :aria-selected="String(tab === 'profile')" @click="pick('profile')">
        <span class="ti" aria-hidden="true">👤</span> Profil
      </button>
    </div>

    <div class="hrow">
      <div class="brand">
        <!-- The red accent bar that used to sit here is gone (user's call,
             2026-08-13) — the crest is the mark, and a second vertical rule
             beside it was competing with it.
             Only the ELEMENT is removed; the `.bar` rule stays in map.css
             because StatCards renders the same class for its status bars. -->
        <div class="logo"><img :src="logo" alt="Jabatan Bomba dan Penyelamat Malaysia"></div>
        <div>
          <!-- Wordmark FIRST, kicker under it — the mockup's order, and the same
               arrangement the login gate uses. One product, one wordmark (§10):
               both read var(--brand), so the header and the sign-in screen
               cannot drift into two different brands.
               .kx is dropped at 640px: the full string is ~200px and used to
               push the tabs onto a row of their own (§3). -->
          <h1 class="disp" id="brandWordmark">e-Pili Bomba</h1>
          <div class="kicker">BBP Kunak<span class="kx"> · Sabah · Bomba Malaysia</span></div>
        </div>
      </div>

      <Pills :counts="counts" :active="statusFilter"
             @pick="(s) => emit('pickStatus', s)" @clear="emit('pickStatus', null)" />

      <div class="hright">
        <button class="addbtn" id="headerAdd" :class="{ 'ro-hidden': !isAdmin }" @click="emit('add')">
          <span style="font-size:16px;line-height:1">+</span> Tambah Pili
        </button>
        <div class="clock"><span class="u">DATE</span><span class="t" id="dateNow">{{ dateNow }}</span></div>
        <!-- "TIME", not "MYT" — the mockup's label. The value is unchanged and
             still Malaysian time; MYT was telling officers the timezone they
             are standing in. -->
        <div class="clock"><span class="u">TIME</span><span class="t" id="clock">{{ clock }}</span></div>
        <!-- The Live pip and the role badge are GONE (user's call, 2026-08-13).
             Both were decoration competing for the width this row needs: the pip
             never reported anything an officer acts on, and the role is stated
             plainly on the Profil tab, which is one tap away on every device.
             Removing them is what lets Awam / Swasta / Tambah Pili / DATE / TIME
             / Sign out share ONE row instead of wrapping below 1280px.
             `#roleTxt` and `#roleBadge` were the only place the role appeared in
             the header; v2-shell.js now reads it from Profil instead, so the
             requirement is still asserted — the surface moved, it did not go. -->
        <button class="signout" :class="{ hide: !signedIn }" id="signOutBtn" @click="emit('signOut')">Sign out</button>
      </div>

      <!-- phones only: the account + action controls collapse in here -->
      <button class="menubtn" :class="{ open: menuOpen }" id="menuBtn" aria-label="Menu"
              :aria-expanded="String(menuOpen)" aria-controls="menuPanel"
              @click="menuOpen = !menuOpen">
        <span></span><span></span><span></span>
      </button>
      <!-- On a phone this menu IS the navigation. `.tabs` is display:none below
           640px, so these five rows are the only way to change view or sign
           out, and every one of them has to work — no other test viewport
           exercises them (T22).

           The Email and Peranan rows that used to sit at the top are gone: the
           Profil tab shows both, and it is now one tap away inside this same
           menu. -->
      <div class="menupanel" :class="{ hide: !menuOpen }" id="menuPanel" role="menu" aria-labelledby="menuBtn">
        <button class="mitem" :class="{ on: tab === 'map' }" id="mTabMap" role="menuitem"
                :aria-current="tab === 'map' ? 'page' : undefined" @click="pick('map')">
          <span class="mi">🗺️</span> Peta Pili
        </button>
        <button class="mitem" :class="{ on: tab === 'dash' }" id="mTabDash" role="menuitem"
                :aria-current="tab === 'dash' ? 'page' : undefined" @click="pick('dash')">
          <span class="mi">📊</span> Dashboard
        </button>
        <button class="mitem" :class="{ on: tab === 'profile' }" id="mTabProfile" role="menuitem"
                :aria-current="tab === 'profile' ? 'page' : undefined" @click="pick('profile')">
          <span class="mi">👤</span> Profil
        </button>
        <div class="msep"></div>
        <button class="mitem" :class="{ 'ro-hidden': !isAdmin }" id="mAdd" role="menuitem" @click="menuAdd">
          <span class="mi">+</span> Tambah Pili
        </button>
        <!-- `danger` is V1's colour (#fca5a5). The mockup showed an amber Sign
             Out; the user's call was to keep V1's, so this class stays. -->
        <button class="mitem danger" id="mSignOut" role="menuitem" @click="menuSignOut">Sign out</button>
      </div>
    </div>
  </header>
</template>
