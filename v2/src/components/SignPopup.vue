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
 *
 * ── The Sign button ──────────────────────────────────────────────────────
 *
 * This used to open a file picker EVERY time: pick, wait, preview, confirm —
 * five taps, on a phone, in gloves, for something done dozens of times a week
 * with the same image. `Sign` fills the preview from the officer's Profile
 * signature instead.
 *
 * It fills the preview and stops there. It does NOT confirm, because confirming
 * is permanent, and the only thing standing between a mis-tap and an
 * unremovable record is the officer looking at what they are about to file.
 * "One tap fewer" is not worth buying with that.
 *
 * The stencil is COPIED, never referenced: signRow() uploads it to the row's
 * own path. Replacing a Profile signature therefore cannot reach anything
 * already filed. See stores/profile.js.
 *
 * The file picker stays, as `Guna gambar lain`. Removing it would take away a
 * real capability — an officer signing on a colleague's device, or a witness —
 * and this change is to the label, not to what the card can attest.
 */
const props = defineProps({
  busy: { type: Boolean, default: false },
  error: { type: String, default: '' },
  profileSig: { type: String, default: '' },          // the stencil's bytes
  profileSigLoading: { type: Boolean, default: false },
});
const emit = defineEmits(['close', 'confirm', 'goProfile']);

const durl = ref(null);
const working = ref(false);
const showPicker = ref(false);

function useProfileSig() {
  if (!props.profileSig) return;
  durl.value = props.profileSig;
}

async function onPick(e) {
  const file = e.target.files && e.target.files[0];
  // Reset so choosing the SAME file twice still fires a change — otherwise a
  // failed attempt cannot be retried without picking something else.
  e.target.value = '';
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

      <!-- Has a stored signature: one tap fills the preview. -->
      <button v-if="profileSig" class="sigpick" id="sigUseProfile" type="button"
              @click="useProfileSig">
        Sign
      </button>

      <!-- Still fetching it. Deliberately NOT the "add one" prompt: a read in
           flight is not the same as no signature, and telling an officer to
           create one they already have is how they end up with two. -->
      <div v-else-if="profileSigLoading" class="sigsub mono" id="sigSigLoading"
           style="text-align:center;font-size:11px">
        Memuatkan tandatangan…
      </div>

      <!-- None stored: the way out is Profile, not a dead button. -->
      <button v-else class="sigpick" id="sigGoProfile" type="button"
              @click="emit('goProfile')">
        Tambah tandatangan di Profil
      </button>

      <!-- Always available. `Sign` is the fast path, not the only one. -->
      <button v-if="!showPicker" class="sigalt" id="sigOther" type="button"
              @click="showPicker = true">
        Guna gambar lain
      </button>
      <label v-else class="sigpick ghost" id="sigPickLabel">
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
