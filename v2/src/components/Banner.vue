<script setup>
import { computed } from 'vue';
import { STATUS } from '../stores/map-logic.js';

/* "Showing X only" — and the way to get rid of it.
 *
 * The three filter axes stack with AND (CLAUDE.md §3), so the banner lists
 * every one that is applied, joined by "·". Tapping it clears ALL of them:
 * the banner is the single visible statement of what is being hidden, so its
 * clear has to match it exactly, or an officer taps it, sees a filtered map,
 * and has no way to tell which filter is still on.
 *
 * One compact line, on purpose: a longer "buang penapis" caption wrapped to
 * three lines on a phone.
 */
const INSP = {
  ok:   { label: 'Diperiksa',       hex: '#FDF0D5' },
  wait: { label: 'Belum di-sign',   hex: '#669BBC' },
  none: { label: 'Belum diperiksa', hex: '#9CAAB6' },
};

const props = defineProps({
  status: { type: String, default: null },
  insp: { type: String, default: null },
  zone: { type: String, default: null },
});
const emit = defineEmits(['clear']);

const parts = computed(() => {
  const out = [];
  if (props.status) out.push({ text: STATUS[props.status].label, colour: STATUS[props.status].hex });
  if (props.insp) out.push({ text: INSP[props.insp].label, colour: INSP[props.insp].hex });
  if (props.zone) out.push({ text: 'Zon ' + props.zone, colour: '#fff' });
  return out;
});
/* The accent follows status, then insp — and NOT zone. V1 overwrites `hex` in
 * those two branches only; the zone branch pushes its label without touching
 * it, so a zone filter keeps whatever accent was already there (red when it is
 * the only filter). Easy to "tidy" into last-axis-wins, which changes the
 * colour of the banner whenever a zone is picked. */
const hex = computed(() => {
  if (props.insp) return INSP[props.insp].hex;
  if (props.status) return STATUS[props.status].hex;
  return '#ef4444';
});
const shown = computed(() => parts.value.length > 0);
</script>

<template>
  <div
    class="panel banner"
    :class="{ hide: !shown }"
    id="banner"
    :style="shown ? { boxShadow: '0 0 0 1px ' + hex + '44,0 12px 30px rgba(0,0,0,.5)', cursor: 'pointer' } : null"
    :title="shown ? 'Ketik untuk buang penapis' : null"
    @click="shown && emit('clear')"
  >
    <template v-if="shown">
      <span class="d soft-pulse" :style="{ background: hex }"></span>
      <span class="t bt">Menunjukkan <template v-for="(p, i) in parts" :key="i"><span
        :style="{ fontWeight: 600, color: p.colour }">{{ p.text }}</span><template
        v-if="i < parts.length - 1"> · </template></template> sahaja</span>
      <span class="bx" aria-hidden="true">✕</span>
    </template>
  </div>
</template>
