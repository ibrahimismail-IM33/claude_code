import { createApp } from 'vue';
import { createPinia } from 'pinia';
import App from './App.vue';
import './styles/tokens.css';
import './styles/shell.css';
/* Leaflet's OWN stylesheets, and they are not optional.
 *
 * V1 loads these as three <link> tags (index.html). V2 shipped without them for
 * five phases, and the map rendered as scattered tiles with black gaps from
 * first paint: without these rules the panes and tiles never get
 * `position:absolute`, so tiles lay out in normal flow. Panning cannot repair
 * it, because panning transforms a pane that was never positioned.
 *
 * They MUST come before map.css. `cssCodeSplit:false` concatenates in import
 * order, and map.css overrides .leaflet-container, .leaflet-control-zoom a and
 * .leaflet-tooltip — those overrides lose if they land first. */
import 'leaflet/dist/leaflet.css';
import 'leaflet.markercluster/dist/MarkerCluster.css';
import 'leaflet.markercluster/dist/MarkerCluster.Default.css';
import './styles/map.css';
import './styles/dashboard.css';
import './styles/profile.css';
// LAST in the chain, and deliberately so: the record card's print rules must
// win, and several of them sit at the same specificity as screen rules.
import './styles/kad-rekod.css';

/* A dynamically-imported chunk failed to load. Vite fires this instead of
 * leaving the rejection unhandled, and the overwhelming cause is a tab left
 * open across a deploy: the running build asks for a hashed chunk (Leaflet, a
 * lazy view) that the new build purged, so it 404s (§4 — "where is the map?").
 * Reload once to pick up the fresh index and its chunk names. The sessionStorage
 * guard stops a reload loop if the asset is genuinely gone rather than stale —
 * in that case MapView's own notice offers a manual retry. */
if (typeof window !== 'undefined') {
  window.addEventListener('vite:preloadError', () => {
    try {
      if (!sessionStorage.getItem('epb_preload_reloaded')) {
        sessionStorage.setItem('epb_preload_reloaded', '1');
        location.reload();
      }
    } catch (e) { /* storage blocked; the in-app notice is the fallback */ }
  });
}

createApp(App).use(createPinia()).mount('#app');
