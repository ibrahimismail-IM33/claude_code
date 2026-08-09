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
  // Phone only: is the bottom sheet expanded? See the note above the handle.
  mobOpen: { type: Boolean, default: false },
});
const emit = defineEmits(['toggleSheet', 'openSheet']);

const pad = (n) => String(n).padStart(2, '0');
const scope = computed(() => (props.visibleCount === props.total ? 'ALL' : 'FILTERED'));
const pct = (s) => (props.total ? (props.counts[s] / props.total) * 100 : 0);
</script>

<template>
  <div class="cards" :class="{ 'mob-open': mobOpen }">
    <div class="panel card">
      <!-- PHONE BOTTOM SHEET.
           On a phone map.css parks this card at translateY(calc(100% - 52px)) —
           a 52px sliver — and only `.cards.mob-open` brings it back. V2 shipped
           with neither the handle nor the summary, so the registry was
           unreachable on the device the app is actually used on. Both are
           display:none on desktop, so they cost nothing there. -->
      <div class="mob-handle" @click.stop="emit('toggleSheet')"></div>
      <div class="mob-reg-summary" @click.stop="emit('openSheet')">
        <div style="display:flex;align-items:center;gap:8px">
          <span class="sr-dots" id="mobDots">
            <span v-for="s in ORDER" :key="s" :style="{ background: STATUS[s].hex }"></span>
          </span>
          <span><span class="sr-cnt" id="mobSrCnt">{{ pad(visibleCount) }}</span><span class="sr-lbl" style="margin-left:4px">units</span></span>
        </div>
        <span style="font-family:var(--mono);font-size:10px;color:rgba(255,255,255,.3);letter-spacing:.1em">▲ tap to expand</span>
      </div>

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
