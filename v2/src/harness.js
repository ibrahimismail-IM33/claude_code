import { createApp, reactive, h } from 'vue';
import { createPinia } from 'pinia';
import DashView from './components/DashView.vue';
import './styles/tokens.css';
import './styles/dashboard.css';

/* Component test harness. NOT shipped — built only under V2_HARNESS=1.
 *
 * It mounts the real DashView with fixtures injected on `window.__fixture`, so
 * tests/v2-dashboard-view.js can drive the actual components in a real browser
 * and assert against the frozen selectors in docs/DOM-CONTRACT.md.
 *
 * Emitted events are recorded rather than acted on. What matters at this phase
 * is that a click on a zone row or a figure reports the right thing; wiring
 * that to the map belongs to Phase 3.
 */
const fixture = reactive(Object.assign({
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
}, window.__fixture || {}));

window.__events = [];
window.__setFixture = (patch) => { Object.assign(fixture, patch); };

createApp({
  render() {
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
