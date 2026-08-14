<script setup>
import { ref, onMounted, onBeforeUnmount, watch, nextTick } from 'vue';
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
  // Is the map tab actually showing? LEAFLET MIS-MEASURES ITSELF WHILE HIDDEN,
  // and the map is kept mounted behind v-show so an officer keeps their pan —
  // so the container collapses to zero on the dashboard and Leaflet believes
  // that stale size when it comes back. Tiles then land against the wrong
  // viewport: scattered squares with gaps. Found on staging, first day.
  active: { type: Boolean, default: true },
  /* Bumped whenever something OUTSIDE the map changes its container size —
   * today, the phone registry sheet sliding up and down. V1 calls
   * map.invalidateSize() on every sheet toggle for exactly this reason. It is
   * the same hazard as §4.16 and §4.17: Leaflet believing a size it no longer
   * has, and tiles landing against the wrong viewport. */
  remeasure: { type: Number, default: 0 },
  /* Bumped when a marker's APPEARANCE changes without the visible SET changing
   * — a saved inspection date, a cleared one, a pending badge appearing or
   * clearing. This is V1's explicit `refresh()` call, and it is needed because
   * `draw()` only runs when `visible` changes identity: that array comes from
   * filters-logic.visible(), which reads status/insp/zone/query and never
   * `lastInspected`, so with no filter active it is the SAME array and the
   * `deep:false` watcher sees nothing. The badge then stayed stale until a
   * pull or a tab switch happened to rebuild it — "late to appear, needed
   * refresh".
   *
   * Deliberately not `deep:true` on `visible`: that walks the whole register on
   * every unrelated change. Deliberately not making `lastInspected` a filter
   * input either — it is not one, and pretending otherwise to buy reactivity
   * would misdescribe what the filter does. */
  redraw: { type: Number, default: 0 },
});
const emit = defineEmits(['pick', 'pickLatLng', 'fitted', 'mapfail']);

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
  // Library blocked or its chunk 404'd across a deploy. V1 shows a notice; V2
  // used to just `return` and leave a blank map area with no explanation
  // (§4 — "where is the map?"). Tell the shell so it can show a reload notice.
  if (!L || !L.map) { emit('mapfail'); return; }
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

/* Re-measure when the map becomes visible again.
 *
 * LEAFLET MIS-MEASURES ITSELF WHILE HIDDEN. The map is kept mounted behind
 * v-show so an officer keeps their pan across a tab switch — which means its
 * container collapses to zero on the dashboard, and Leaflet goes on believing
 * that size when it returns. Tiles then land against the wrong viewport:
 * scattered squares with black gaps between them.
 *
 * V1 does the same thing in setTab and its comment says exactly this. Found on
 * staging on the first day of real use.
 *
 * Twice, because the container regains its size a frame or two after v-show
 * clears `display:none` — a single attempt can land before layout. */
watch(() => props.active, (on) => {
  if (!on || !map) return;
  nextTick(() => {
    if (map) map.invalidateSize();
    setTimeout(() => { if (map) map.invalidateSize(); }, 200);
  });
});

/* Redraw the markers without re-fitting. `draw()` consults fitDecision(), and
 * the key is unchanged here, so no fit happens — the officer's pan survives a
 * save, which is the same guarantee §3 gives background pulls. */
watch(() => props.redraw, () => { if (map) draw(); });

/* Re-measure without re-fitting. The sheet animates for 350ms (map.css), so a
 * single immediate call would measure mid-slide — hence the settle. Deliberately
 * NOT a fit: the officer's pan must survive opening the registry. */
watch(() => props.remeasure, () => {
  if (!map) return;
  map.invalidateSize();
  setTimeout(() => { if (map) map.invalidateSize(); }, 380);
});
</script>

<template>
  <div id="map" ref="el"></div>
</template>
