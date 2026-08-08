import { createApp, reactive, h } from 'vue';
import { createPinia } from 'pinia';
import DashView from './components/DashView.vue';
import MapShell from './components/MapShell.vue';
import './styles/tokens.css';
import './styles/dashboard.css';
import './styles/map.css';

/* Component test harness. NOT shipped — built only under V2_HARNESS=1.
 *
 * It mounts a real component with fixtures injected on `window.__fixture`, so
 * the suites can drive the actual components in a real browser and assert
 * against the frozen selectors in docs/DOM-CONTRACT.md.
 *
 * Emitted events are recorded rather than acted on. What matters at this phase
 * is that a click reports the right thing; wiring it to the rest of the app is
 * the job of the shell that replaces index.html.
 */
const fixture = reactive(Object.assign({
  view: 'dash',
  // dashboard
  hydrants: [],
  index: {},
  statusFilter: null,
  inspFilter: null,
  zoneFilter: null,
  periodIx: 0,
  source: '',
  sweep: 1,
  jadual: [],
  jadualSource: '',
  isAdmin: false,
  cloudNote: '',
  // map
  query: '',
  noFitOnce: false,
  adding: false,
  pending: [],          // hydrant ids with unsent work
  insp: {},             // id -> 'ok' | 'wait' | 'none'
}, window.__fixture || {}));

window.__events = [];
window.__setFixture = (patch) => { Object.assign(fixture, patch); };

const record = (name) => (v) => window.__events.push([name, v]);

createApp({
  render() {
    if (fixture.view === 'map') {
      return h(MapShell, {
        hydrants: fixture.hydrants,
        statusFilter: fixture.statusFilter,
        inspFilter: fixture.inspFilter,
        zoneFilter: fixture.zoneFilter,
        query: fixture.query,
        noFitOnce: fixture.noFitOnce,
        adding: fixture.adding,
        inspStatusOf: (hy) => fixture.insp[hy.id] || 'none',
        hasPending: (id) => fixture.pending.indexOf(id) >= 0,
        onPick: record('pick'),
        onPickLatLng: record('latlng'),
        onPickStatus: (s) => { window.__events.push(['status', s]); fixture.statusFilter = s; },
        onClearFilters: () => {
          window.__events.push(['clear', null]);
          fixture.statusFilter = null; fixture.inspFilter = null; fixture.zoneFilter = null;
        },
        onFitted: record('fitted'),
      });
    }
    return h(DashView, {
      ...fixture,
      onPickStatus: (k) => window.__events.push(['status', k]),
      onPickZone: (z) => window.__events.push(['zone', z]),
      onPickPeriod: (i) => { window.__events.push(['period', i]); fixture.periodIx = i; },
      onJadualAdd: (r) => window.__events.push(['jadual-add', r]),
      onJadualUpdate: (r) => window.__events.push(['jadual-update', r]),
      onJadualDelete: (id) => window.__events.push(['jadual-delete', id]),
    });
  },
}).use(createPinia()).mount('#app');
