<script setup>
import { computed, ref } from 'vue';
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
  isAdmin: { type: Boolean, default: false },
  draft: { type: Object, default: null },
  saving: { type: Boolean, default: false },
  addError: { type: String, default: '' },
});
const emit = defineEmits(['pick', 'pickLatLng', 'pickStatus', 'clearFilters', 'fitted',
                          'search', 'closeAdd', 'addHydrant']);

/* A search resets the fit key so the map re-zooms onto the matches. The key
 * belongs to MapView, so the reset is a ref it watches rather than something
 * SearchBox reaches in and sets — the fit rule has exactly one owner. */
const refit = ref(0);

const vis = computed(() => visibleOf(props.hydrants, {
  status: props.statusFilter, insp: props.inspFilter, zone: props.zoneFilter, query: props.query,
}, props.inspStatusOf));

const counts = computed(() => countsOf(props.hydrants));
</script>

<template>
  <SearchBox :query="query" :match-count="vis.length" :status="statusFilter"
             @search="(v) => emit('search', v)" @refit="refit++" />

  <div class="maparea">
    <MapView
      :visible="vis"
      :has-pending="hasPending"
      :refit="refit"
      :no-fit-once="noFitOnce"
      :active="active"
      :adding="adding"
      @pick="(h) => emit('pick', h)"
      @pick-lat-lng="(p) => emit('pickLatLng', p)"
      @fitted="(d) => emit('fitted', d)"
    />

    <Registry :visible-count="vis.length" :total="hydrants.length" :counts="counts" />

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
