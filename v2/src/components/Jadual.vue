<script setup>
import { computed, ref } from 'vue';
import { sorted, page, dmy, isPast, JADUAL_PAGE } from '../stores/jadual-logic.js';
import { halfList, halfRange, halfLabel } from '../stores/dashboard-logic.js';

/* Jadual Pemeriksaan — the shared schedule.
 *
 * Decisions carried over from V1, each of which was asked for:
 *
 *  - Admin only, matching hydrants and records. One permission model.
 *  - NO "done" tick. The signed Pengujian row already proves an inspection
 *    happened; a second flag would be a second version of the truth and would
 *    drift from the first.
 *  - NO date filter. It was built, then the user asked for it gone — the period
 *    selector plus a date-sorted list is enough. Do not re-add it.
 *  - Edit REUSES the add form: the button flips to "Simpan" and "Batal"
 *    appears. One set of fields, one set of validation, nothing to keep in step.
 *  - Edit is an icon (pencil) with title + aria-label carrying the meaning, so
 *    the column stays narrow on a phone.
 *  - Delete asks for confirmation and sits 6px from edit, because it is one
 *    button away and cannot be undone.
 *  - An edit belongs to the period it started in, so changing period ends it.
 */
const props = defineProps({
  rows: { type: Array, default: () => [] },
  periodIx: { type: Number, default: 0 },
  source: { type: String, default: '' },
  capped: { type: Boolean, default: false },
  isAdmin: { type: Boolean, default: false },
  today: { type: String, default: () => new Date().toISOString().slice(0, 10) },
});
const emit = defineEmits(['add', 'update', 'remove', 'pickLocation']);

const showAll = ref(false);
const editId = ref(null);
const form = ref({ t: '', pas: '', l: '' });
const msg = ref('');

const period = computed(() => halfList()[props.periodIx]);
const range = computed(() => halfRange(period.value));
const all = computed(() => sorted(props.rows, range.value));
const shown = computed(() => page(all.value, showAll.value));

// Never expected at realistic volume; if it ever happens the header says so
// rather than undercounting quietly.
const srcText = computed(() => props.capped ? props.source + ' · 1000 pertama sahaja' : props.source);

function startEdit(row) {
  if (!props.isAdmin) { msg.value = 'Hanya admin boleh menyunting jadual.'; return; }
  editId.value = row.id;
  form.value = { t: row.t || '', pas: row.pas || '', l: row.l || '' };
}
function endEdit() { editId.value = null; form.value = { t: '', pas: '', l: '' }; }

function submit() {
  if (!props.isAdmin) return;
  const r = { t: form.value.t, pas: form.value.pas, l: form.value.l };
  if (!r.t) { msg.value = 'Sila isi Tarikh.'; return; }
  msg.value = '';
  if (editId.value != null) { emit('update', { id: editId.value, ...r }); endEdit(); }
  else { emit('add', r); form.value = { t: '', pas: '', l: '' }; }
}

function remove(row) {
  if (!props.isAdmin) return;
  if (!window.confirm('Buang baris jadual ini?')) return;
  if (String(editId.value) === String(row.id)) endEdit();  // don't leave the form editing a deleted row
  emit('remove', row.id);
}

// An edit belongs to the period it started in.
defineExpose({ endEdit });
</script>

<template>
  <div class="dcard">
    <h2>Jadual pemeriksaan · <span id="dashJadualPeriod">{{ halfLabel(period) }}</span>
      <span id="dashJadualSrc" class="jsrc">{{ srcText }}</span></h2>

    <div class="dform" v-if="isAdmin">
      <div class="df"><label for="jTarikh">Tarikh</label>
        <input id="jTarikh" type="date" v-model="form.t"></div>
      <div class="df"><label for="jPasukan">Pasukan</label>
        <input id="jPasukan" type="text" placeholder="cth: Pasukan A" v-model="form.pas"></div>
      <div class="df"><label for="jLokasi">Lokasi</label>
        <input id="jLokasi" type="text" placeholder="cth: Balai Bomba Kunak" v-model="form.l"></div>
      <button class="dbtn" id="jAdd" type="button" @click="submit">
        {{ editId != null ? 'Simpan' : '+ Tambah' }}
      </button>
      <button class="jclear" id="jCancel" type="button" v-if="editId != null" @click="endEdit">Batal</button>
    </div>

    <div class="dtwrap"><table>
      <thead><tr><th style="width:130px">Tarikh</th><th style="width:170px">Pasukan</th>
        <th>Lokasi</th><th style="width:80px"></th></tr></thead>
      <tbody id="dashJadual">
        <tr v-if="!all.length">
          <td colspan="4" class="dempty">Tiada jadual bagi {{ halfLabel(period) }} — tambah di atas.</td>
        </tr>
        <tr v-for="r in shown" :key="r.id"
            :class="{ jpast: isPast(r, today), jedit: String(editId) === String(r.id) }">
          <td class="dmono">{{ dmy(r.t) }}<span v-if="isPast(r, today)" class="jlapsed">lepas</span></td>
          <td>{{ r.pas }}</td>
          <td><button class="loclink" type="button" :data-loc="r.l"
                      @click="emit('pickLocation', r.l)">{{ r.l }}</button></td>
          <td>
            <span class="jact" v-if="isAdmin">
              <button class="dedit" :data-id="String(r.id)" title="Sunting" aria-label="Sunting baris"
                      type="button" @click="startEdit(r)">
                <svg viewBox="0 0 24 24" aria-hidden="true">
                  <path d="M4 20h4L19 9a2.1 2.1 0 0 0-3-3L5 17v3z"></path>
                  <path d="M14.5 7.5 16.5 9.5"></path>
                </svg>
              </button>
              <button class="ddel" :data-id="String(r.id)" title="Buang" aria-label="Buang baris"
                      type="button" @click="remove(r)">✕</button>
            </span>
          </td>
        </tr>
      </tbody>
    </table></div>

    <button class="jmore" id="jMore" type="button"
            v-if="all.length > JADUAL_PAGE" @click="showAll = !showAll">
      {{ showAll ? 'Tunjuk 100 pertama' : 'Lihat semua (' + shown.length + ' daripada ' + all.length + ')' }}
    </button>
    <div class="jmsg" id="jMsg" v-if="msg">{{ msg }}</div>
  </div>
</template>
