<script setup>
import { computed } from 'vue';
import StatCards from './StatCards.vue';
import Donut from './Donut.vue';
import ZonePanel from './ZonePanel.vue';
import { dashData, dashScopeLabel, halfList, halfRange, halfLabel } from '../stores/dashboard-logic.js';
import { zoneSummary } from '../stores/filters-logic.js';

/* The dashboard.
 *
 * It stores NO numbers. Everything below is derived from the same Pengujian
 * rows the Kad Rekod writes — one source of truth, nothing to drift
 * (CLAUDE.md §2). If a counter ever appears in this component's state, that
 * decision has been undone.
 *
 * Scope follows the map's Awam/Swasta pills including the cleared state, which
 * means Semua and not Awam (§4.3). The one exception is the zone panel, which
 * always reads the whole register — see ZonePanel.vue.
 */
const props = defineProps({
  hydrants: { type: Array, required: true },
  index: { type: Object, required: true },      // Pengujian rows by hydrant id
  statusFilter: { type: String, default: null },  // Awam / Swasta pill
  inspFilter: { type: String, default: null },    // which figure is filtering the map
  zoneFilter: { type: String, default: null },
  periodIx: { type: Number, default: 0 },
  source: { type: String, default: '' },          // "Data awan ✓" / device-only
  sweep: { type: Number, default: 1 },
});
const emit = defineEmits(['pickStatus', 'pickZone', 'pickPeriod']);

const periods = computed(() => halfList());
const range = computed(() => halfRange(periods.value[props.periodIx]));
const data = computed(() => dashData(props.hydrants, props.statusFilter, props.index, range.value));
const scope = computed(() => dashScopeLabel(props.statusFilter));

// Always the whole register — never props.hydrants filtered by the pills.
const zones = computed(() => zoneSummary(props.hydrants));
</script>

<template>
  <section id="dashView">
    <div class="dashhead">
      <select id="dashPeriod" :value="periodIx" @change="emit('pickPeriod', +$event.target.value || 0)">
        <option v-for="(o, i) in periods" :key="i" :value="i">
          {{ halfLabel(o) }}{{ i === 0 ? '  (semasa)' : '  (arkib)' }}
        </option>
      </select>
      <span id="dashScope">{{ scope }}</span>
      <span id="dashSrc">{{ source }}</span>
    </div>

    <StatCards :data="data" :active="inspFilter" @pick="(k) => emit('pickStatus', k)" />
    <Donut :data="data" :sweep="sweep" @pick="(k) => emit('pickStatus', k)" />

    <div class="dashgrid">
      <div id="dashRecent"><slot name="recent" /></div>
      <div class="zonebox">
        <ZonePanel :summary="zones" :active="zoneFilter" @pick="(z) => emit('pickZone', z)" />
      </div>
    </div>
  </section>
</template>
