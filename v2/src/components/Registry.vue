<script setup>
import { computed } from 'vue';
import { STATUS, ORDER } from '../stores/map-logic.js';

/* The registry card: how many pili are on the map right now, and the
 * Awam/Swasta split.
 *
 * Note the two different denominators, which is deliberate:
 *   regNum   counts what is VISIBLE — it answers "what am I looking at".
 *   the bars are proportions of the WHOLE register — they answer "what is the
 *   station's split", which does not change when a filter is applied.
 * Making both follow the filter would turn the bars into a permanent 100%.
 *
 * `.card` is one of the global class names already taken by this app
 * (CLAUDE.md §5), which is why the dashboard scopes everything under #dashView.
 * Here it is the ORIGINAL owner of the name, so it keeps it.
 */
const props = defineProps({
  visibleCount: { type: Number, required: true },
  total: { type: Number, required: true },
  counts: { type: Object, required: true },     // over the whole register
});

const pad = (n) => String(n).padStart(2, '0');
const scope = computed(() => (props.visibleCount === props.total ? 'ALL' : 'FILTERED'));
const pct = (s) => (props.total ? (props.counts[s] / props.total) * 100 : 0);
</script>

<template>
  <div class="cards">
    <div class="panel card">
      <div class="reg-top">
        <span class="reg-tag">Registry</span>
        <span class="reg-scope" id="regScope">{{ scope }}</span>
      </div>
      <div class="reg-num"><b id="regNum">{{ pad(visibleCount) }}</b><s>units</s></div>
      <div class="reg-bars" id="regBars">
        <div v-for="s in ORDER" :key="s">
          <div class="blab">
            <span class="lhs">
              <span class="bdot" :style="{ background: STATUS[s].hex }"></span>{{ STATUS[s].label }}
            </span>
            <span class="rhs">{{ pad(counts[s]) }}</span>
          </div>
          <div class="btrack">
            <div class="bfill" :style="{ width: pct(s) + '%', background: STATUS[s].hex,
                                         boxShadow: '0 0 8px ' + STATUS[s].hex + '99' }"></div>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>
