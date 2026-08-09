<script setup>
import { computed } from 'vue';
import { buildDonut } from '../lib/donut.js';

/* The 3D donut.
 *
 * The SVG is generated as a STRING by lib/donut.js and injected, rather than
 * being expressed as Vue template elements. That is deliberate:
 *
 *  - the geometry is a verbatim port guarded by exact-string comparison against
 *    V1 (tests/v2-donut-parity.js), and rebuilding it as ~200 template nodes
 *    would put that guarantee beyond reach;
 *  - the entry animation redraws the whole ring up to 60 times, and diffing a
 *    few hundred SVG nodes per frame is strictly more work than replacing one
 *    innerHTML — the animation currently drops ZERO frames at 8x CPU
 *    throttling (CLAUDE.md §6) and that budget is worth keeping.
 *
 * v-html is safe here: every byte comes from buildDonut, which composes numbers
 * and a fixed palette. No user data reaches it — the labels are constants and
 * the only variables are counts.
 *
 * Clicks are DELEGATED, matching V1: the paths are replaced on every frame, so
 * per-element listeners would only ever bind the first render.
 */
const props = defineProps({
  data: { type: Object, required: true },   // { total, ok, wait, none }
  sweep: { type: Number, default: 1 },
});
const emit = defineEmits(['pick']);

/* Coarser arcs (6°) while the ring is still sweeping, full 2° resolution for
 * the frame that lands — a large part of why the entry animation drops ZERO
 * frames at 8x CPU throttling (CLAUDE.md §6). V1 does the same in dAnimate.
 *
 * Decided HERE and not inside buildDonut: the parity fixtures build
 * intermediate frames at DSTEP and compare them to V1 byte-for-byte, so a
 * resolution derived from `sweep` inside the generator makes every
 * mid-animation frame differ. */
const svg = computed(() => buildDonut(props.data, props.sweep, props.sweep < 1 ? 6 : undefined));

function onClick(e) {
  let el = e.target;
  while (el && el !== e.currentTarget) {
    if (el.getAttribute && el.getAttribute('data-key')) { emit('pick', el.getAttribute('data-key')); return; }
    el = el.parentNode;
  }
}
</script>

<template>
  <div class="donutwrap" id="dashDonut" @click="onClick" v-html="svg"></div>
</template>
