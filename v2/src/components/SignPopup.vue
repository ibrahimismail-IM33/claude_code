<script setup>
import { ref } from 'vue';
import { resizeImage } from '../lib/signature-capture.js';

/* Attaching a signature to a row.
 *
 * THIS IS THE ONLY IRREVERSIBLE ACTION IN THE APP. Once confirmed the row can
 * never be edited, cleared or deleted — by anyone, including an admin — and the
 * image can never be replaced (docs/KAD-REKOD.md §5). So the wording says so
 * before the officer commits, and the confirm button is labelled
 * "Sahkan & Kunci" rather than "Simpan": it locks, and that must not be a
 * surprise afterwards.
 *
 * Admin-only, and the server agrees: RLS refuses the write regardless of what
 * this component allows. Hiding it is courtesy, not the control.
 *
 * The photo is keyed and trimmed BEFORE upload (signature-capture.js), which is
 * capture-side and therefore only ever affects signatures taken from now on. It
 * can do nothing for a card already filed — that is why the printing fix lives
 * separately, at render time.
 */
defineProps({
  busy: { type: Boolean, default: false },
  error: { type: String, default: '' },
});
const emit = defineEmits(['close', 'confirm']);

const durl = ref(null);
const working = ref(false);

async function onPick(e) {
  const file = e.target.files && e.target.files[0];
  if (!file) return;
  working.value = true;
  // 600px is V1's cap: enough to read a signature, small enough that an
  // officer on a field connection is not uploading a phone-camera original.
  const d = await resizeImage(file, 600);
  working.value = false;
  durl.value = d || null;
}
</script>

<template>
  <div class="sigmodal" @click.self="emit('close')">
    <div class="sigbox">
      <div class="sightitle">Tandatangan (T.T)</div>
      <p class="sigsub">
        Lampirkan gambar tandatangan. Selepas disahkan, baris ini
        <b>dikunci kekal</b> dan tidak boleh diubah.
      </p>

      <label class="sigpick">
        📷 Pilih gambar / Ambil foto
        <input type="file" accept="image/*" id="sigFile" style="display:none" @change="onPick">
      </label>

      <div class="sigprev" id="sigPrev">
        <img v-if="durl" :src="durl" alt="Pratonton tandatangan">
        <span v-else-if="working" class="mono" style="font-size:11px">Memproses…</span>
      </div>

      <p v-if="error" class="autherr" style="margin-top:0">{{ error }}</p>

      <div class="sigacts">
        <button class="fbtn ghost" id="sigCancel" @click="emit('close')">Batal</button>
        <button class="fbtn" id="sigOk" :disabled="!durl || busy || working"
                @click="emit('confirm', durl)">
          {{ busy ? 'Memuat naik…' : 'Sahkan & Kunci' }}
        </button>
      </div>
    </div>
  </div>
</template>
