<script setup>
import { computed } from 'vue';

/* The three figures. Each is a button that filters the map.
 *
 * The markup matches V1 element for element — .bar / .body / .fig and the
 * .num.n-* classes are what dashboard.css targets, and the ids (dnOk, dpOk …)
 * are read by the test suites. This is not stylistic: the stylesheet is a
 * verbatim copy, so any structural liberty taken here silently unstyles a card.
 *
 * Colour: the .num ink is green / blue / red, measured against the card base
 * #121419 at 10.6 : 7.3 : 6.7 contrast, all above 4.5:1. Deliberately NOT
 * applied to the donut fill or to the word under each chart percentage — those
 * keep the cream/steel/#9CAAB6 palette so a label still matches the slice its
 * leader line points at. Navy is never text anywhere: 1.42:1 on dark
 * (CLAUDE.md §3).
 *
 * `sweep` counts the figures up from zero during the entry animation, exactly
 * as V1's dPaint does — Math.round on the count, one decimal on the percent.
 */
const props = defineProps({
  data: { type: Object, required: true },   // { total, ok, wait, none }
  active: { type: String, default: null },
  sweep: { type: Number, default: 1 },
});
const emit = defineEmits(['pick']);

const CARDS = [
  { k: 'ok',   id: 'Ok',   bar: '#FDF0D5', t: 'Diperiksa',       d: 'Baris Pengujian lengkap dan bertandatangan' },
  { k: 'wait', id: 'Wait', bar: '#669BBC', t: 'Belum di-sign',   d: 'Pengujian sudah diisi, tandatangan belum' },
  { k: 'none', id: 'None', bar: '#003049', t: 'Belum diperiksa', d: 'Tiada baris Pengujian dalam tempoh ini' },
];

const total = computed(() => props.data.total || 1);
const num = (k) => Math.round(props.data[k] * props.sweep);
const pct = (k) => (props.data[k] / total.value * 100 * props.sweep).toFixed(1) + '%';
</script>

<template>
  <div class="dstats">
    <button
      v-for="c in CARDS"
      :key="c.k"
      class="dstat"
      :class="{ on: active === c.k }"
      type="button"
      :data-f="c.k"
      @click="emit('pick', c.k)"
    >
      <span class="bar" :style="{ background: c.bar }"></span>
      <span class="body">
        <span class="t">{{ c.t }}</span>
        <span class="d">{{ c.d }}</span>
      </span>
      <span class="fig">
        <span class="num" :class="'n-' + c.k" :id="'dn' + c.id">{{ num(c.k) }}</span>
        <span class="pc" :id="'dp' + c.id">{{ pct(c.k) }}</span>
        <span class="go">Lihat di peta →</span>
      </span>
    </button>
  </div>
</template>
