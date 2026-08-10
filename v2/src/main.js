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

createApp(App).use(createPinia()).mount('#app');
