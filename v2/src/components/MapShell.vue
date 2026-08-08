<script setup>
import { computed } from 'vue';
import MapView from './MapView.vue';
import Pills from './Pills.vue';
import Registry from './Registry.vue';
import Banner from './Banner.vue';
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
});
const emit = defineEmits(['pick', 'pickLatLng', 'pickStatus', 'clearFilters', 'fitted']);

const vis = computed(() => visibleOf(props.hydrants, {
  status: props.statusFilter, insp: props.inspFilter, zone: props.zoneFilter, query: props.query,
}, props.inspStatusOf));

const counts = computed(() => countsOf(props.hydrants));
</script>

<template>
  <div class="maparea">
    <MapView
      :visible="vis"
      :has-pending="hasPending"
      :no-fit-once="noFitOnce"
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

    <div class="panel chip"><span class="d soft-pulse"></span><span class="t">Tap hydrant · date shown on icon</span></div>
  </div>

  <!-- The pills live in the shared header in V1, not inside the map area. They
       are rendered here for the harness; the real header assembles them in
       Phase 4. Their handler must refresh the dashboard too — §4.2 was exactly
       this: the pills moved the scope while the dashboard sat unchanged. -->
  <Pills :counts="counts" :active="statusFilter"
         @pick="(s) => emit('pickStatus', s)" @clear="emit('pickStatus', null)" />
</template>
