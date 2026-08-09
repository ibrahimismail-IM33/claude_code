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

function keyOf(target, root) {
  let el = target;
  while (el && el !== root) {
    if (el.getAttribute && el.getAttribute('data-key')) return el.getAttribute('data-key');
    el = el.parentNode;
  }
  return null;
}

function onClick(e) {
  const k = keyOf(e.target, e.currentTarget);
  if (k) emit('pick', k);
}

/* Hover dimming: pointing at one segment fades the others, so the label and
 * the slice it belongs to are unmistakable. Ported from V1 — `.d-dim` was
 * styled in dashboard.css and never applied by anything, which is how it was
 * found. Delegated, like the click handler, because the paths are replaced on
 * every animation frame.
 *
 * Keyboard parity too: the segments carry tabindex and role=button, so Enter
 * and Space must act like a click or they are buttons that cannot be pressed. */
function onOver(e) {
  const k = keyOf(e.target, e.currentTarget);
  e.currentTarget.querySelectorAll('.seg3d').forEach((p) => {
    p.classList.toggle('d-dim', !!k && p.getAttribute('data-key') !== k);
  });
}
function onLeave(e) {
  e.currentTarget.querySelectorAll('.seg3d').forEach((p) => p.classList.remove('d-dim'));
}
function onKey(e) {
  if (e.key !== 'Enter' && e.key !== ' ') return;
  const k = keyOf(e.target, e.currentTarget);
  if (k) { e.preventDefault(); emit('pick', k); }
}
</script>

<template>
  <div class="donutwrap" id="dashDonut" @click="onClick" @mouseover="onOver"
       @mouseleave="onLeave" @keydown="onKey" v-html="svg"></div>
</template>
