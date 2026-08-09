<script setup>
import { computed } from 'vue';
import { STATUS } from '../stores/map-logic.js';

/* The hydrant detail modal — what a pin tap opens.
 *
 * A VERBATIM port of V1's `openDetail` (index.html), and the two-step it sits
 * in is deliberate: pin → THIS → Kad Rekod. V2 shipped wired straight to the
 * card, which looked like a shortcut and was actually a loss. What is only
 * here, and nowhere else in the app:
 *
 *   - **Directions.** Turn-by-turn navigation to the hydrant. This is the
 *     screen an officer uses standing in a field trying to reach a pili, and
 *     losing it is the most expensive part of the gap.
 *   - The coordinates, at six decimals, readable and quotable over radio.
 *   - Last Inspected, derived from the latest Pengujian date.
 *
 * Nothing new is invented here. The chrome classes (.overlay .panel .modal
 * .m440 .fadeIn, .m-head/.m-body/.m-foot, .cdot .soft-pulse, .box, .maplink,
 * .btn-ghost) are already in styles/map.css, copied from V1 — they were sitting
 * there styled and unused, which is exactly how this omission was found.
 * STATUS comes from map-logic.js and is already byte-identical to V1's.
 *
 * The Google Maps URLs are built from the NUMERIC lat/lng, never from the
 * label or location: those are officer-entered text and have no business in a
 * URL. Vue escapes interpolation, so V1's esc() has no equivalent need here.
 */
const props = defineProps({
  hydrant: { type: Object, required: true },
});
const emit = defineEmits(['close', 'openCard']);

const cf = computed(() => STATUS[props.hydrant.status] || STATUS.kerajaan);

const gdir = computed(() => 'https://www.google.com/maps/dir/?api=1&destination='
  + props.hydrant.lat + ',' + props.hydrant.lng);
const gmap = computed(() => 'https://www.google.com/maps?q='
  + props.hydrant.lat + ',' + props.hydrant.lng);

/* V1 formats this by hand rather than with toLocaleDateString, and the shape
 * is dd/mm/yyyy. An unparseable value falls back to the raw string instead of
 * printing "Invalid Date" at an officer. */
const lastInspected = computed(() => {
  const li = props.hydrant.lastInspected;
  if (!li) return '—';
  const d = new Date(li);
  if (isNaN(d.getTime())) return String(li);
  const pad = (n) => String(n).padStart(2, '0');
  return pad(d.getDate()) + '/' + pad(d.getMonth() + 1) + '/' + d.getFullYear();
});
</script>

<template>
  <div class="overlay" data-ov="1" @click.self="emit('close')">
    <div class="panel modal m440 fadeIn" id="hydrantDetail">
      <div class="m-head">
        <div style="margin-top:4px">
          <span class="cdot soft-pulse"
                :style="'display:block;width:12px;height:12px;background:' + cf.hex + ';box-shadow:0 0 12px ' + cf.hex"></span>
        </div>
        <div style="flex:1;min-width:0">
          <div style="display:flex;align-items:center;gap:8px">
            <span class="lab" style="margin:0">Unit</span>
            <span class="mono" style="font-size:10px;padding:2px 6px;border-radius:4px;background:rgba(255,255,255,.06);border:1px solid rgba(255,255,255,.1);color:rgba(255,255,255,.5)">{{ cf.short }}</span>
          </div>
          <h2>{{ hydrant.label }}</h2>
          <p class="m-sub">{{ hydrant.location || '—' }}</p>
        </div>
        <button class="m-close" data-close="1" @click="emit('close')">×</button>
      </div>

      <div class="m-body">
        <div class="box" style="display:flex;align-items:flex-start;gap:12px">
          <span style="font-size:20px;margin-top:2px">📍</span>
          <div style="flex:1;min-width:0">
            <p class="lab" style="margin-bottom:4px">Coordinates</p>
            <p class="mono tab" id="dCoords" style="font-size:14px;color:#fff">{{ hydrant.lat.toFixed(6) }}, {{ hydrant.lng.toFixed(6) }}</p>
            <div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:8px">
              <a class="maplink" id="dDir" :href="gdir" target="_blank" rel="noopener"
                 :style="'margin-top:0;background:' + cf.hex + ';border-color:transparent;color:' + (hydrant.status === 'swasta' ? '#1a1200' : '#fff')">🧭 Directions ↗</a>
              <a class="maplink" id="dView" :href="gmap" target="_blank" rel="noopener" style="margin-top:0">🗺️ View ↗</a>
            </div>
          </div>
        </div>

        <button class="btn" id="dOpenForm" style="width:100%;margin-top:2px;background:#111;border:1px solid rgba(255,255,255,.15);color:#fff"
                @click="emit('openCard', hydrant)">📋 Kad Rekod Pili Bomba</button>

        <div>
          <p class="lab">Last Inspected</p>
          <p class="mono" id="dLastInsp" style="font-size:13px;color:#fff;margin:0">{{ lastInspected }}
            <span style="color:rgba(255,255,255,.4);font-size:11px">(auto — latest Pengujian date)</span>
          </p>
        </div>
      </div>

      <div class="m-foot">
        <button class="btn btn-ghost" data-close="1" style="flex:1" @click="emit('close')">Close</button>
      </div>
    </div>
  </div>
</template>
