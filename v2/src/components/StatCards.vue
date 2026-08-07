<script setup>
/* The three figures. Each is a button that filters the map.
 *
 * The ink is the only place in the app where colour is allowed to mean
 * pass/pending/outstanding: green #4ADE80, blue #60A5FA, red #F87171, measured
 * against the card base #121419 at 10.6 : 7.3 : 6.7 contrast — all above 4.5:1.
 *
 * Note what does NOT take these colours: the donut fill and the word under each
 * chart percentage keep the cream/steel/#9CAAB6 palette, so a label still
 * matches the slice its leader line points at. And navy is never text anywhere
 * — it is 1.42:1 on dark, so #9CAAB6 substitutes (CLAUDE.md §3).
 */
defineProps({
  data: { type: Object, required: true },   // { total, ok, wait, none }
  active: { type: String, default: null },  // which status is filtering the map
});
const emit = defineEmits(['pick']);

const CARDS = [
  { k: 'ok',   label: 'Diperiksa' },
  { k: 'wait', label: 'Belum di-sign' },
  { k: 'none', label: 'Belum diperiksa' },
];
</script>

<template>
  <div class="dstats">
    <button
      v-for="c in CARDS"
      :key="c.k"
      class="stat dstat"
      :class="{ on: active === c.k }"
      type="button"
      :data-f="c.k"
      @click="emit('pick', c.k)"
    >
      <!-- .stat is a <button>, which does NOT inherit page colour — the title
           fell back to the UA default and washed out once already (§4.6). The
           colour is set in CSS on these classes, never left to inheritance. -->
      <span class="dstat-n" :class="'ink-' + c.k">{{ data[c.k] }}</span>
      <span class="dstat-t">{{ c.label }}</span>
    </button>
  </div>
</template>
