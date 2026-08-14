<script setup>
import { computed, ref, watch, nextTick } from 'vue';
import MapView from './MapView.vue';
import Registry from './Registry.vue';
import Banner from './Banner.vue';
import SearchBox from './SearchBox.vue';
import AddHydrantModal from './AddHydrantModal.vue';
import { visible as visibleOf, counts as countsOf } from '../stores/filters-logic.js';

/* The Peta Pili tab: map, scope pills, registry card, filter banner.
 *
 * The filtering itself is NOT done here — it comes from filters-logic.js, which
 * keeps the three axes (Awam/Swasta x inspection status x zone) stacking with
 * AND in ONE derived pass. Three components each filtering their own copy is
 * how that invariant gets broken quietly (CLAUDE.md §3).
 *
 * Counts go to the pills and the registry bars over the WHOLE register, never
 * the filtered view: a pill that reads "17" and becomes "17 of 17" once tapped
 * tells an officer nothing, and the registry bars are a statement about the
 * station's split rather than about the current filter.
 */
const props = defineProps({
  hydrants: { type: Array, required: true },
  statusFilter: { type: String, default: null },
  inspFilter: { type: String, default: null },
  zoneFilter: { type: String, default: null },
  query: { type: String, default: '' },
  inspStatusOf: { type: Function, default: () => 'none' },
  hasPending: { type: Function, default: () => false },
  noFitOnce: { type: Boolean, default: false },
  adding: { type: Boolean, default: false },
  active: { type: Boolean, default: true },   // the map tab is showing
  redraw: { type: Number, default: 0 },       // marker appearance changed
  isAdmin: { type: Boolean, default: false },
  draft: { type: Object, default: null },
  saving: { type: Boolean, default: false },
  addError: { type: String, default: '' },
});
const emit = defineEmits(['pick', 'pickLatLng', 'pickStatus', 'clearFilters', 'fitted',
                          'search', 'closeAdd', 'addHydrant']);

/* The map library failed to load (see the notice in the template). Reloading is
 * the recovery — it fetches the fresh index and the chunk names it references. */
const mapFailed = ref(false);
function reloadPage() { if (typeof location !== 'undefined') location.reload(); }

/* A search resets the fit key so the map re-zooms onto the matches. The key
 * belongs to MapView, so the reset is a ref it watches rather than something
 * SearchBox reaches in and sets — the fit rule has exactly one owner. */
const refit = ref(0);

const vis = computed(() => visibleOf(props.hydrants, {
  status: props.statusFilter, insp: props.inspFilter, zone: props.zoneFilter, query: props.query,
}, props.inspStatusOf));

const counts = computed(() => countsOf(props.hydrants));

/* Probed once: a browser blocking localStorage will not change its mind
 * mid-session, and V1 checks it exactly this way. */
const storageOK = (() => {
  try {
    const k = '__probe_' + Date.now();
    window.localStorage.setItem(k, '1');
    window.localStorage.removeItem(k);
    return true;
  } catch (e) { return false; }
})();

/* The phone registry bottom sheet. V1 keeps this state as a class on `.cards`
 * and calls map.invalidateSize() on every toggle — the sheet changes the map
 * container's height, and a Leaflet that believes a stale size is §4.16/§4.17
 * all over again. `remeasure` is how that reaches MapView. */
const mobOpen = ref(false);
const remeasure = ref(0);
function setSheet(open) { mobOpen.value = open; remeasure.value++; }
function toggleSheet() { setSheet(!mobOpen.value); }
// Tapping the map closes the sheet, as V1 does on touchend.
function mapTouched() { if (mobOpen.value) setSheet(false); }

/* Fade the panel in on tab switch. The class is removed and re-added because
 * v-show does not remount, so a CSS animation would otherwise never re-run.
 * OPACITY ONLY over a live map — see the note in shell.css. */
const panelIn = ref(false);
let panelTimer = null;
watch(() => props.active, (on) => {
  if (!on) return;
  panelIn.value = false;
  nextTick(() => {
    panelIn.value = true;
    if (panelTimer) clearTimeout(panelTimer);
    panelTimer = setTimeout(() => { panelIn.value = false; panelTimer = null; }, 300);
  });
});
</script>

<template>
  <SearchBox :query="query" :match-count="vis.length" :status="statusFilter"
             @search="(v) => emit('search', v)" @refit="refit++" />

  <div class="maparea" :class="{ 'panel-in': panelIn }" @touchend.passive="mapTouched">
    <MapView
      :visible="vis"
      :has-pending="hasPending"
      :refit="refit"
      :no-fit-once="noFitOnce"
      :active="active"
      :remeasure="remeasure"
      :redraw="redraw"
      :adding="adding"
      @pick="(h) => emit('pick', h)"
      @pick-lat-lng="(p) => emit('pickLatLng', p)"
      @fitted="(d) => emit('fitted', d)"
      @mapfail="mapFailed = true"
    />

    <Registry :visible-count="vis.length" :total="hydrants.length" :counts="counts"
              :mob-open="mobOpen"
              @toggle-sheet="toggleSheet" @open-sheet="setSheet(true)" />

    <Banner
      :status="statusFilter" :insp="inspFilter" :zone="zoneFilter"
      @clear="emit('clearFilters')"
    />

    <!-- V1 shows this the moment the add modal opens, so a map tap has a
         stated meaning rather than being a thing you have to already know. -->
    <div class="panel hint" :class="{ hide: !adding }" id="hint">
      <span>👆</span> Click anywhere on map to set lat / long for new pili
    </div>

    <div class="panel chip"><span class="d soft-pulse"></span><span class="t">Tap hydrant · date shown on icon</span></div>

    <!-- Map library failed to load. Almost always a tab left open across a
         deploy asking for a hashed chunk the new build purged (§4). V2 used to
         render nothing here — a blank area with no explanation — while V1 has
         always shown a notice. A reload picks up the fresh index and chunk
         names, which is the recovery an officer otherwise had to stumble onto. -->
    <div v-if="mapFailed" class="panel maperr" role="alert" id="mapErr">
      <div class="maperr-msg">Peta tidak dapat dimuat.</div>
      <button type="button" class="maperr-btn" @click="reloadPage">Muat semula</button>
    </div>

    <!-- Storage blocked. Ported from V1, and it matters more than it looks:
         every offline guarantee in this app is localStorage. A failed save is
         parked in `bbpkunak_pending_*` and pushed on reconnect (§4.10) — if
         storage is unavailable that parking is a no-op and an officer's typing
         is gone with nothing on screen to say so. Probed once at mount, the
         same way V1 does it, because a private-mode browser will not change its
         mind mid-session. -->
    <div class="panel" id="storeWarn" v-if="!storageOK"
         style="position:absolute;bottom:16px;left:16px;z-index:500;max-width:260px;padding:10px 12px;border-color:rgba(250,204,21,.35)!important">
      <div style="display:flex;gap:8px;align-items:flex-start">
        <span style="font-size:14px;line-height:1.2">⚠️</span>
        <span style="font-size:11px;line-height:1.4;color:rgba(253,224,71,.9)">Edits won't survive a refresh in this view. Download the file and open it in Chrome/Firefox to keep changes.</span>
      </div>
    </div>
  </div>

  <!-- The pills live in the shared header in V1, not inside the map area. They
       are rendered here for the harness; the real header assembles them in
       Phase 4. Their handler must refresh the dashboard too — §4.2 was exactly
       this: the pills moved the scope while the dashboard sat unchanged. -->
  <AddHydrantModal v-if="adding && isAdmin" :hydrants="hydrants" :draft="draft"
                   :saving="saving" :error="addError"
                   @close="emit('closeAdd')" @save="(h) => emit('addHydrant', h)" />

  <Pills :counts="counts" :active="statusFilter"
         @pick="(s) => emit('pickStatus', s)" @clear="emit('pickStatus', null)" />
</template>
