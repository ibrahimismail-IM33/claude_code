<script setup>
import { STATUS, ORDER } from '../stores/map-logic.js';

/* Awam / Swasta scope pills.
 *
 * They live in the SHARED header, so they can be tapped while the dashboard is
 * the visible tab — which is exactly what §4.2 was: their handler only
 * refreshed the map, so the dashboard figures sat there unchanged while the
 * scope had moved underneath them. Whatever owns these must redraw both.
 *
 * The counts are of the WHOLE register, not the filtered view: a pill showing
 * "17" that becomes "17 of 17" when tapped would tell an officer nothing.
 */
defineProps({
  counts: { type: Object, required: true },     // { kerajaan, swasta } over the whole register
  active: { type: String, default: null },
});
const emit = defineEmits(['pick', 'clear']);

const pad = (n) => String(n).padStart(2, '0');
const cfg = (s) => STATUS[s];
</script>

<template>
  <!-- BOTH, exactly as V1 (`<div class="pills" id="pills">`). The class is not
       decoration: every rule that lays this row out is written `.pills` — the
       base flex in map.css and the whole mobile block in shell.css — so with
       only the id they all matched nothing and the pills stacked one per line
       on a phone, with no nowrap and no horizontal scroll. Dead since the port,
       and invisible to tests/v2-parity-surface.js because it matches the bare
       token `pills`, which `id="pills"` supplies on its own. -->
  <div class="pills" id="pills">
    <button
      v-for="s in ORDER"
      :key="s"
      class="pill"
      :class="{ active: active === s }"
      :data-s="s"
      :style="active === s ? { boxShadow: '0 0 0 1px ' + cfg(s).hex + '55,0 8px 20px -10px ' + cfg(s).hex } : null"
      @click="emit('pick', s)"
    >
      <span class="pdot" :class="{ 'soft-pulse': active === s }"
            :style="{ background: cfg(s).hex, boxShadow: '0 0 10px ' + cfg(s).hex }"></span>
      <span class="plabel">{{ cfg(s).label }}</span>
      <span class="pcount" :style="{ background: cfg(s).hex + '22', color: cfg(s).hex }">{{ pad(counts[s]) }}</span>
    </button>
    <button v-if="active" class="clearf" data-clear="1" @click="emit('clear')">clear ✕</button>
  </div>
</template>
