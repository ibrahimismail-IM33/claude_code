<script setup>
import { ref, computed, watch } from 'vue';
import { searchInfo } from '../stores/filters-logic.js';

/* Place search.
 *
 * The behaviour that matters is not the typing, it is what a search DOES to
 * the rest of the view (CLAUDE.md §3, and V1's applySearch/goMapSearch):
 *
 *  - It ignores the Awam/Swasta pills and searches the whole register.
 *    Nothing may be hidden from a search — an officer looking for A26 must
 *    find it whether or not Swasta is selected — and the result line says so
 *    rather than leaving the two silently disagreeing.
 *  - It resets the fit key, so the map re-zooms onto the matches. Without that
 *    a search finds three pili and leaves the view where it was.
 *
 * The second is emitted as `refit` rather than done here: the fit key lives in
 * MapView, and a component that reaches into another one's state is exactly
 * how the background-pull rule gets broken by accident.
 */
const props = defineProps({
  query: { type: String, default: '' },
  matchCount: { type: Number, default: 0 },
  status: { type: String, default: null },   // the Awam/Swasta pill, for the note
});
const emit = defineEmits(['search', 'refit']);

const inp = ref(null);
const info = computed(() => searchInfo(props.matchCount, props.query, props.status));

function apply(v) {
  emit('refit');            // let the map re-zoom onto the matches
  emit('search', v || '');
}

// V1 lets goMapSearch() write into the box from the dashboard, so the input is
// driven by the prop and not by its own state.
watch(() => props.query, (v) => { if (inp.value && inp.value.value !== v) inp.value.value = v; });

function onKey(e) {
  if (e.key === 'Escape' || e.keyCode === 27) {
    if (inp.value) { inp.value.value = ''; inp.value.blur(); }
    apply('');
  }
}
function onClear() {
  if (inp.value) { inp.value.value = ''; inp.value.focus(); }
  apply('');
}
</script>

<template>
  <div class="searchrow">
    <div class="searchbox">
      <span class="sicon">🔍</span>
      <input id="searchInput" ref="inp" type="search" autocomplete="off" autocapitalize="none" spellcheck="false"
             :value="query"
             placeholder="Cari No. Pili atau Lokasi — cth: A01, Hospital Kunak, Kg. Getah"
             @input="apply($event.target.value)" @keydown="onKey" />
      <button class="sclear" :class="{ hide: !info.clear }" id="searchClear"
              title="Kosongkan carian" aria-label="Kosongkan carian" @click="onClear">✕</button>
    </div>
    <div class="sresult" :class="{ hide: !info.show }" id="searchResult">
      <template v-if="info.show">
        <span v-if="!info.none"><b>{{ info.count }}</b> pili dijumpai</span>
        <span v-else class="none">Tiada pili dijumpai</span>
        <span v-if="info.note" class="note">· penapis Awam/Swasta diabaikan semasa mencari</span>
      </template>
    </div>
  </div>
</template>
