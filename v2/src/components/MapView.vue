<script setup>
import { ref, onMounted, onBeforeUnmount, watch } from 'vue';
import { getL, loadL } from '../lib/leaflet.js';
import { markerHtml, ICON_OPTS, tipHtml, fitDecision } from '../stores/map-logic.js';

/* The map.
 *
 * Leaflet stays IMPERATIVE. Markers are not Vue components and must not become
 * them: 187 markers plus clustering driven through Vue's reactivity is slower
 * than Leaflet's own handling and buys nothing (docs/V2-ROADMAP.md, Phase 3).
 * Vue owns when to redraw; Leaflet owns what is on the map.
 *
 * The fit rule lives in map-logic.js and is only APPLIED here, so the decision
 * stays testable without a map. Its whole point is a background pull that must
 * never re-fit — the failure is not an error, it is the map jumping away from
 * what an officer is reading, on a phone, mid-read.
 */
const props = defineProps({
  visible: { type: Array, required: true },     // already filtered by the store
  hasPending: { type: Function, default: () => false },
  // Armed by a background pull. Consumed on the next render: the key is
  // recorded WITHOUT fitting, so the next genuine change still fits.
  noFitOnce: { type: Boolean, default: false },
  adding: { type: Boolean, default: false },
  // Bumped by a search. V1 does the same with `fittedKey = ""` inside
  // applySearch: without it a search finds three pili and leaves the view
  // exactly where it was, which reads as the search having done nothing.
  refit: { type: Number, default: 0 },
});
const emit = defineEmits(['pick', 'pickLatLng', 'fitted']);

const el = ref(null);
let map = null, layer = null, fittedKey = '';
const markers = new Map();

// Counted so a test can assert it is 0 during a background pull — the
// end-to-end version of what fitDecision() guarantees in isolation.
if (typeof window !== 'undefined') window.__fitCount = window.__fitCount || 0;

function draw() {
  if (!map || !layer) return;
  const L = getL();
  layer.clearLayers();
  markers.clear();
  props.visible.forEach((h) => {
    const m = L.marker([h.lat, h.lng], {
      icon: L.divIcon(Object.assign({ html: markerHtml(h.status, h.lastInspected, props.hasPending(h.id)) }, ICON_OPTS)),
    });
    m.bindTooltip(tipHtml(h, props.hasPending(h.id)), { direction: 'top', offset: [0, -56] });
    m.on('click', () => emit('pick', h));
    layer.addLayer(m);
    markers.set(h.id, m);
  });

  const d = fitDecision(props.visible, fittedKey, props.noFitOnce);
  fittedKey = d.fittedKey;
  if (d.fit) {
    if (typeof window !== 'undefined') window.__fitCount++;
    map.fitBounds(L.latLngBounds(props.visible.map((h) => [h.lat, h.lng])), { padding: [90, 90], maxZoom: 18 });
  }
  emit('fitted', d);
}

onMounted(async () => {
  // await, because the seam only loads the real library when nothing has
  // provided one — a static import would clobber the tests' window.L stub.
  const L = await loadL();
  if (!L || !L.map) return;                 // library blocked; V1 shows a notice
  map = L.map(el.value, { center: [4.694, 118.239], zoom: 17, zoomControl: false });
  L.control.zoom({ position: 'topright' }).addTo(map);
  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',
    { attribution: '&copy; OpenStreetMap', maxZoom: 19 }).addTo(map);
  // Cluster if the plugin is there, otherwise a plain group. Same fallback as
  // V1 — the map must still work if clustering is unavailable.
  layer = (typeof L.markerClusterGroup === 'function')
    ? L.markerClusterGroup({ chunkedLoading: true, maxClusterRadius: 55, showCoverageOnHover: false, spiderfyOnMaxZoom: true })
    : L.layerGroup();
  layer.addTo(map);
  map.on('click', (e) => { if (props.adding) emit('pickLatLng', { lat: e.latlng.lat, lng: e.latlng.lng }); });
  draw();
  // Tiles have to fill the container once it has its final size.
  const fix = () => { if (map) map.invalidateSize(); };
  setTimeout(fix, 0); setTimeout(fix, 200); setTimeout(fix, 600);
  window.addEventListener('resize', fix);
  onBeforeUnmount(() => window.removeEventListener('resize', fix));
});

/* ONE watcher, not two. A search changes `visible` and bumps `refit` in the
 * same tick, and two watchers would fit the map twice — one wasted animation
 * on a phone, and a second fit racing the first. The reset happens before the
 * draw so the single fitDecision() sees a cleared key, exactly as V1's
 * applySearch does. */
watch(() => [props.visible, props.refit], ([, r], old) => {
  if (old && r !== old[1]) fittedKey = '';
  draw();
}, { deep: false });
</script>

<template>
  <div id="map" ref="el"></div>
</template>
