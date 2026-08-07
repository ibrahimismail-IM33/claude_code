<script setup>
import { computed } from 'vue';

/* "Nombor Pili Terkini".
 *
 * Two things here are load-bearing and both are documented decisions:
 *
 *  - It reads the WHOLE register and ignores the Awam/Swasta pills. It answers
 *    "what number does the next pili get?", which is a fact about the register,
 *    not about a filter. Following the pills would make zone A's range jump
 *    between A114 and A91 as Swasta is toggled, and "the last number" would
 *    stop meaning the last number. The caption says so.
 *  - It is BUTTONS, not a table. `#dashView table` carries min-width:460px for
 *    the wide record tables, and reusing that inside this narrow grid column
 *    pushes the page sideways on a phone (CLAUDE.md §4.9).
 *
 * The selectors below are frozen in docs/DOM-CONTRACT.md.
 */
const props = defineProps({
  summary: { type: Object, required: true },   // { zones, odd } from filters-logic
  active: { type: String, default: null },     // the zone currently filtering the map
});
const emit = defineEmits(['pick']);

const gapped = computed(() => props.summary.zones.filter((e) => e.gap).map((e) => 'Zon ' + e.zone));
</script>

<template>
  <div class="zlist" id="dashZones">
    <div v-if="!summary.zones.length" class="znote">Tiada pili berdaftar.</div>
    <button
      v-for="e in summary.zones"
      :key="e.zone"
      class="zrow"
      :class="{ zwarn: e.gap, on: active === e.zone }"
      type="button"
      :data-z="e.zone"
      :title="'Tunjuk pili Zon ' + e.zone + ' pada peta sahaja'"
      @click="emit('pick', e.zone)"
    >
      <span class="zk">{{ e.zone }}</span>
      <span class="zr">{{ e.first }} – {{ e.last }}</span>
      <span class="zc">{{ e.count }} pili</span>
    </button>
  </div>

  <!-- The caption is where the panel admits what it cannot show. A panel whose
       rows silently sum to less than the register is misinformation, so an
       unparseable label is reported rather than given a "Lain-lain" row; and a
       range implies contiguity, so a gap is called out. -->
  <div class="znote" id="dashZoneNote" v-if="summary.zones.length">
    Semua pili · tidak mengikut penapis Awam/Swasta<span v-if="gapped.length" class="zbad">Nombor tidak berturutan dalam {{ gapped.join(', ') }} — julat lebih besar daripada bilangan sebenar.</span><span v-if="summary.odd" class="zbad">{{ summary.odd }} pili tidak mengikut format zon (cth A01) dan tidak disenaraikan di atas.</span>
  </div>
  <div class="znote" id="dashZoneNote" v-else></div>
</template>
