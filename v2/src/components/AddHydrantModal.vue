<script setup>
import { ref, computed, watch } from 'vue';
import { STATUS, ORDER, validAdd, canAdd, defaultLabel, today, clampDate,
         newHydrant, geoMessage, geoAccuracyMessage } from '../stores/map-logic.js';

/* Tambah Pili Bomba.
 *
 * V1 rebuilt this modal's entire innerHTML on every keystroke and re-wired the
 * handlers each time (openAdd → draw → wire). Vue makes that a template, which
 * is the single largest readability win in Phase 3 — but the BEHAVIOUR is
 * copied, not improved:
 *
 *  - The save button stays disabled and reads "Fill Lat/Long" until the
 *    coordinates and the label are all valid. A hydrant with a bad coordinate
 *    is a pin in the sea, and the officer who typed it is standing next to the
 *    real one with no way to tell.
 *  - "Guna Lokasi Saya" needs `geolocation=(self)` in `_headers`. That header
 *    is why the button works at all; nothing in this file can compensate for
 *    its absence.
 *  - The save reaches the DATABASE FIRST and only then shows the pili locally
 *    (V1's cloudInsertNew callback). A new pili that exists on one phone and
 *    nowhere else is worse than one that failed loudly — so the parent owns
 *    the save and reports back through `saving` / `error`.
 *
 * A map click while this is open fills the coordinates: `draft` is watched
 * rather than read once, because the officer taps the map with the modal
 * already up.
 */
const props = defineProps({
  hydrants: { type: Array, required: true },
  draft: { type: Object, default: null },     // {lat,lng} picked from the map
  saving: { type: Boolean, default: false },
  error: { type: String, default: '' },
});
const emit = defineEmits(['close', 'save']);

const st = ref('kerajaan');
const label = ref(defaultLabel(props.hydrants));
const insp = ref(today());
const lat = ref(props.draft ? props.draft.lat.toFixed(6) : '');
const lng = ref(props.draft ? props.draft.lng.toFixed(6) : '');

// Geolocation status line, shared with the save error so the officer only ever
// has one place to look for what went wrong.
const geoText = ref('Guna Lokasi Saya');
const geoBusy = ref(false);
const msg = ref({ text: '', colour: 'rgba(255,255,255,.55)' });

watch(() => props.draft, (d) => {
  if (!d) return;
  lat.value = d.lat.toFixed(6);
  lng.value = d.lng.toFixed(6);
});
watch(() => props.error, (e) => { if (e) msg.value = { text: e, colour: '#fca5a5' }; });

const v = computed(() => validAdd(lat.value, lng.value, label.value));
const can = computed(() => canAdd(lat.value, lng.value, label.value));
const cf = computed(() => STATUS[st.value]);
const preview = computed(() => (v.value.la && v.value.lo)
  ? 'https://www.google.com/maps?q=' + parseFloat(lat.value) + ',' + parseFloat(lng.value)
  : null);

function say(text, colour) { msg.value = { text, colour: colour || 'rgba(255,255,255,.55)' }; }

function useMyLocation() {
  if (!navigator.geolocation) { say('Peranti ini tidak menyokong GPS.', '#fca5a5'); return; }
  geoBusy.value = true; geoText.value = 'Mencari lokasi…';
  say('Pastikan anda berdiri betul-betul di sebelah pili bomba.');
  navigator.geolocation.getCurrentPosition((pos) => {
    geoBusy.value = false; geoText.value = 'Guna Lokasi Saya';
    const c = pos.coords;
    lat.value = c.latitude.toFixed(6);
    lng.value = c.longitude.toFixed(6);
    const a = geoAccuracyMessage(c.accuracy);
    say(a.text, a.colour);
  }, (err) => {
    geoBusy.value = false; geoText.value = 'Guna Lokasi Saya';
    say(geoMessage(err), '#fca5a5');
  }, { enableHighAccuracy: true, timeout: 15000, maximumAge: 0 });
}

function save() {
  if (!can.value) return;
  emit('save', newHydrant(props.hydrants, {
    label: label.value, lat: lat.value, lng: lng.value, status: st.value, insp: insp.value,
  }));
}
</script>

<template>
  <div class="overlay" data-ov="1" @click.self="emit('close')">
    <div class="panel modal m480 fadeIn">
      <div class="m-head">
        <div class="add-ic" style="height:40px;width:40px;border-radius:12px;font-size:20px;border-color:rgba(250,204,21,.3)">➕</div>
        <div style="flex:1;min-width:0">
          <span class="mono" style="font-size:10px;letter-spacing:.25em;text-transform:uppercase;color:rgba(253,224,71,.7)">Add New Unit</span>
          <h2>Tambah Pili Bomba</h2>
          <p class="m-sub" style="font-size:12px;margin-top:4px">Manual input lat / long · BBP Kunak</p>
        </div>
        <button class="m-close" data-close="1" @click="emit('close')">×</button>
      </div>

      <div class="m-body">
        <div v-if="draft" class="picked"><span>📍</span><span>Picked from map: {{ draft.lat.toFixed(6) }}, {{ draft.lng.toFixed(6) }}</span></div>

        <div style="display:grid;grid-template-columns:1.1fr .9fr;gap:12px">
          <div><p class="lab">Label / ID</p>
            <input class="inp" id="aLabel" style="font-weight:700;letter-spacing:.03em" v-model="label"></div>
          <div><p class="lab">Last Inspected</p>
            <input class="inp mono" id="aInsp" type="date" :max="today()"
                   :value="insp" @input="insp = clampDate($event.target.value)"></div>
        </div>

        <div><p class="lab">Classification</p>
          <div class="grid2">
            <button v-for="s in ORDER" :key="s" class="cls" :class="{ sel: st === s }" :data-s="s"
                    :style="st === s
                      ? 'padding:12px;box-shadow:0 0 0 1px ' + STATUS[s].hex + ',0 8px 24px -8px ' + STATUS[s].hex + '66;border-color:' + STATUS[s].hex
                      : 'padding:12px'"
                    @click="st = s">
              <div class="top" style="margin-bottom:6px"><span>{{ STATUS[s].icon }}</span>
                <span class="cdot" :class="{ 'soft-pulse': st === s }"
                      :style="'width:8px;height:8px;background:' + STATUS[s].hex + (st === s ? '' : ';opacity:.4')"></span></div>
              <div class="nm" style="font-size:15px">{{ STATUS[s].label }}</div>
              <div class="bl">{{ STATUS[s].blurb }}</div>
            </button>
          </div>
        </div>

        <div class="box" style="border-radius:12px;padding:14px;background:rgba(255,255,255,.02);display:flex;flex-direction:column;gap:12px">
          <div style="display:flex;align-items:center;justify-content:space-between;gap:8px">
            <p class="lab" style="margin:0">Manual Coordinates</p>
            <span class="mono" style="font-size:9px;color:rgba(255,255,255,.3)">Click map to autofill</span>
          </div>

          <button class="btn" id="aGeo" type="button" :disabled="geoBusy" @click="useMyLocation"
                  style="width:100%;background:#2563eb;color:#fff;box-shadow:0 8px 22px -10px #2563eb;display:flex;align-items:center;justify-content:center;gap:8px">
            <span style="font-size:15px;line-height:1">📍</span><span id="aGeoTxt">{{ geoText }}</span>
          </button>
          <p class="mono" id="aGeoMsg" :style="{ display: msg.text ? 'block' : 'none', color: msg.colour }"
             style="font-size:10px;line-height:1.5;margin:0">{{ msg.text }}</p>

          <div class="grid2">
            <div><label class="mono" style="font-size:10px;color:rgba(255,255,255,.5)">Latitude</label>
              <input class="inp mono tab" :class="{ bad: !(v.la || lat === '') }" id="aLat"
                     style="margin-top:4px;background:rgba(0,0,0,.3)" inputmode="decimal" placeholder="4.695991" v-model="lat">
              <p class="err" id="aLatErr" :style="{ display: (!v.la && lat !== '') ? 'block' : 'none' }">-90 to 90</p></div>
            <div><label class="mono" style="font-size:10px;color:rgba(255,255,255,.5)">Longitude</label>
              <input class="inp mono tab" :class="{ bad: !(v.lo || lng === '') }" id="aLng"
                     style="margin-top:4px;background:rgba(0,0,0,.3)" inputmode="decimal" placeholder="118.239464" v-model="lng">
              <p class="err" id="aLngErr" :style="{ display: (!v.lo && lng !== '') ? 'block' : 'none' }">-180 to 180</p></div>
          </div>

          <span id="aPrev"><a v-if="preview" class="maplink" :href="preview" target="_blank" rel="noopener"
             style="margin-top:0;background:none;border:none;padding:0;font-size:11px;color:rgba(255,255,255,.6)">🗺️ Preview in Google Maps ↗</a></span>
        </div>
      </div>

      <div class="m-foot">
        <button class="btn btn-ghost" data-close="1" @click="emit('close')">Cancel</button>
        <button class="btn" id="aSave" :disabled="!can || saving" @click="save"
                :style="can ? 'background:' + cf.hex + ';box-shadow:0 8px 24px -8px ' + cf.hex + ';color:#000' : ''">
          {{ saving ? 'Menyimpan…' : (can ? 'Add Hydrant' : 'Fill Lat/Long') }}
        </button>
      </div>
    </div>
  </div>
</template>
