<script setup>
import { computed } from 'vue';
import StatCards from './StatCards.vue';
import Donut from './Donut.vue';
import ZonePanel from './ZonePanel.vue';
import Jadual from './Jadual.vue';
import { dashData, dashScopeLabel, halfList, halfRange, halfLabel, recentRows } from '../stores/dashboard-logic.js';
import { dmy } from '../stores/jadual-logic.js';
import { zoneSummary } from '../stores/filters-logic.js';

/* The dashboard.
 *
 * It stores NO numbers. Everything below is derived from the same Pengujian
 * rows the Kad Rekod writes — one source of truth, nothing to drift
 * (CLAUDE.md §2). If a counter ever appears in this component's state, that
 * decision has been undone.
 *
 * The markup mirrors V1 element for element (.dwrap, .dperiod, .dgrid, .dsec,
 * .dcard) because styles/dashboard.css is a verbatim copy of V1's rules and
 * targets exactly these. Structural liberties here unstyle things silently.
 *
 * Scope follows the map's Awam/Swasta pills INCLUDING the cleared state, which
 * means Semua and not Awam (§4.3). The one exception is the zone panel, which
 * always reads the whole register — see ZonePanel.vue.
 */
const props = defineProps({
  hydrants: { type: Array, required: true },
  index: { type: Object, required: true },        // Pengujian rows by hydrant id
  statusFilter: { type: String, default: null },  // Awam / Swasta pill
  inspFilter: { type: String, default: null },    // which figure filters the map
  zoneFilter: { type: String, default: null },
  periodIx: { type: Number, default: 0 },
  source: { type: String, default: '' },          // "Data awan ✓" / device-only
  sweep: { type: Number, default: 1 },
  jadual: { type: Array, default: () => [] },
  jadualSource: { type: String, default: '' },
  // Surfaced rather than swallowed: if a period ever exceeds the query cap the
  // panel says so instead of quietly undercounting.
  jadualCapped: { type: Boolean, default: false },
  isAdmin: { type: Boolean, default: false },
  cloudNote: { type: String, default: '' },
});
const emit = defineEmits(['pickStatus', 'pickZone', 'pickPeriod',
  'jadualAdd', 'jadualUpdate', 'jadualDelete', 'jadualLocation', 'pickLocation']);

const periods = computed(() => halfList());
const range = computed(() => halfRange(periods.value[props.periodIx]));
const data = computed(() => dashData(props.hydrants, props.statusFilter, props.index, range.value));
const scope = computed(() => dashScopeLabel(props.statusFilter));
const recent = computed(() => recentRows(props.hydrants, props.statusFilter, props.index, range.value));

// Always the whole register — never props.hydrants filtered by the pills.
const zones = computed(() => zoneSummary(props.hydrants));
</script>

<template>
  <div id="dashView">
    <div class="dwrap">
      <div class="dnote" id="dashNote" v-if="cloudNote">{{ cloudNote }}</div>

      <div class="dperiod">
        <span class="lab">Tempoh</span>
        <select id="dashPeriod" aria-label="Pilih tempoh"
                :value="periodIx" @change="emit('pickPeriod', +$event.target.value || 0)">
          <option v-for="(o, i) in periods" :key="i" :value="i">{{ halfLabel(o) }}</option>
        </select>
        <span class="note" id="dashPeriodNote">Kitaran 6 bulan</span>
        <span class="note" id="dashSrc" style="margin-left:auto">{{ source }}</span>
      </div>

      <div class="dgrid">
        <div class="dsec">
          <h2>Ringkasan <span id="dashScope">{{ scope }}</span> — ketik label untuk lihat di peta</h2>
          <Donut :data="data" :sweep="sweep" @pick="(k) => emit('pickStatus', k)" />
        </div>
        <div class="dsec">
          <h2>Status tempoh ini — ketik untuk lihat di peta</h2>
          <StatCards :data="data" :active="inspFilter" :sweep="sweep"
                     @pick="(k) => emit('pickStatus', k)" />
        </div>
      </div>

      <div class="dgrid">
        <div class="dcard">
          <h2>Pemeriksaan terkini</h2>
          <!-- .dtwrap is what stops a 5-column table pushing a 390px page to
               438px wide — the table scrolls inside it (CLAUDE.md §4.9). -->
          <div class="dtwrap"><table>
            <thead><tr><th style="width:120px">Tarikh</th><th style="width:100px">No. Pili</th>
              <th>Lokasi</th><th style="width:140px">Penguji</th><th style="width:120px">Status</th></tr></thead>
            <!-- This was `<slot name="recent" />` and nothing ever filled it,
                 in the app or the harness, so the panel was permanently empty
                 and said nothing about it. Rendered here from the same index
                 every other figure derives from. -->
            <tbody id="dashRecent">
              <tr v-if="!recent.length">
                <td colspan="5" class="dempty">Tiada rekod Pengujian bagi tempoh ini.</td>
              </tr>
              <tr v-for="(r, i) in recent" :key="i">
                <td class="dmono">{{ dmy(r.d) }}</td>
                <td class="dmono" style="font-weight:700">{{ r.label }}</td>
                <td><button class="loclink" type="button" :data-loc="r.loc"
                            @click="emit('pickLocation', r.loc)">{{ r.loc }}</button></td>
                <td class="dmono">{{ r.p }}</td>
                <td><span class="dtag" :class="r.s ? 'ok' : 'wait'">{{ r.s ? 'Bertandatangan' : 'Belum di-sign' }}</span></td>
              </tr>
            </tbody>
          </table></div>
        </div>

        <div class="dcard">
          <h2>Nombor pili terkini</h2>
          <ZonePanel :summary="zones" :active="zoneFilter" @pick="(z) => emit('pickZone', z)" />
        </div>
      </div>

      <Jadual
        :rows="jadual"
        :period-ix="periodIx"
        :source="jadualSource"
        :capped="jadualCapped"
        :is-admin="isAdmin"
        @add="(r) => emit('jadualAdd', r)"
        @update="(r) => emit('jadualUpdate', r)"
        @remove="(id) => emit('jadualDelete', id)"
        @pick-location="(q) => emit('jadualLocation', q)"
      />
    </div>
  </div>
</template>
