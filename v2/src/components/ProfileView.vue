<script setup>
import { ref, watch, nextTick } from 'vue';

/* The Profile tab.
 *
 * It exists to hold ONE thing: the officer's signature, so the Kad Rekod's
 * Sign button has something to pre-fill from. The identity rows above it are
 * read-only — role is granted in the database (`update public.profiles set
 * role='admin' …`), never from the app, and showing it here does not change
 * that. `auth.js` already says why: the client's idea of the role is a UI
 * convenience and nothing else.
 *
 * ADMIN ONLY, and the server agrees. `admins manage profiles` is the policy
 * that permits the write; a viewer has no update path to profiles at all, so
 * the uploader is hidden for them and RLS would refuse it regardless. Hiding
 * it is courtesy, not the control — same rule as everywhere else in this app.
 *
 * The signature shown here may be REPLACED, which is the opposite of every
 * other signature in the app. See stores/profile.js and docs/KAD-REKOD.md:
 * this one is a stencil that gets copied at signing time, so replacing it
 * cannot reach anything already filed.
 */
const props = defineProps({
  email: { type: String, default: '' },
  isAdmin: { type: Boolean, default: false },
  sigUrl: { type: String, default: '' },
  hasSignature: { type: Boolean, default: false },
  busy: { type: Boolean, default: false },
  error: { type: String, default: '' },
  active: { type: Boolean, default: false },
});
const emit = defineEmits(['pickSignature', 'removeSignature', 'signOut']);

const fileEl = ref(null);
const saved = ref(false);
let savedTimer = null;

/* Removing the stored signature.
 *
 * The confirm names what is and is not affected, because the one thing an
 * officer might reasonably fear here is that it touches records they have
 * already signed. It does not — each filed row holds its own copy. */
function askRemove() {
  const ok = window.confirm(
    'Buang tandatangan anda?\n\n'
    + 'Tandatangan pada rekod yang sudah disahkan TIDAK akan berubah. '
    + 'Anda perlu tambah semula sebelum boleh guna butang Sign.');
  if (ok) emit('removeSignature');
}

function onPick(e) {
  const file = e.target.files && e.target.files[0];
  // Reset the input so choosing the SAME file twice still fires a change —
  // otherwise a failed upload cannot be retried without picking something else.
  e.target.value = '';
  if (file) emit('pickSignature', file);
}

/* "Saved" has to be visible, for the same reason the Save button on the card
 * had to say what it did (§4.25): an upload that looks identical whether it
 * reached the server or not is the failure mode this app has already shipped. */
watch(() => props.busy, (now, was) => {
  if (was && !now && !props.error) {
    saved.value = true;
    if (savedTimer) clearTimeout(savedTimer);
    savedTimer = setTimeout(() => { saved.value = false; savedTimer = null; }, 4000);
  }
});

/* Same fade+rise the dashboard gets on a tab switch. Re-armed each time
 * because v-show does not remount. No map here, so a transform is safe. */
const panelIn = ref(false);
let panelTimer = null;
watch(() => props.active, (on) => {
  if (!on) return;
  panelIn.value = false;
  nextTick(() => {
    panelIn.value = true;
    if (panelTimer) clearTimeout(panelTimer);
    panelTimer = setTimeout(() => { panelIn.value = false; panelTimer = null; }, 300);
  });
});
</script>

<template>
  <div id="profileView" :class="{ 'panel-in': panelIn }">
    <div class="pvwrap">

      <div class="pvcard">
        <h2>Akaun</h2>
        <div class="pvrow">
          <span class="pvlab">Email</span>
          <span class="pvval" id="pvEmail">{{ email || '—' }}</span>
        </div>
        <div class="pvrow">
          <span class="pvlab">Peranan</span>
          <span class="pvval">
            <span class="pvbadge" :class="{ admin: isAdmin }" id="pvRole">{{ isAdmin ? 'Admin' : 'Viewer' }}</span>
          </span>
        </div>
      </div>

      <div class="pvcard">
        <h2>Tandatangan</h2>

        <div class="pvsig" id="pvSig">
          <img v-if="sigUrl" :src="sigUrl" alt="Tandatangan anda">
          <span v-else class="pvnone" id="pvSigNone">
            {{ hasSignature ? 'Tidak dapat memuatkan tandatangan.' : 'Belum ada tandatangan.' }}
          </span>
        </div>

        <p class="pvnote" v-if="isAdmin">
          Tandatangan ini digunakan semasa menekan <b>Sign</b> pada Kad Rekod.
          Ia boleh <b>ditukar bila-bila masa</b> — tandatangan pada rekod yang
          <b>sudah disahkan tidak akan berubah</b>, kerana salinan berasingan
          disimpan pada rekod itu semasa disahkan.
        </p>
        <p class="pvnote" v-else>
          Hanya admin boleh menyimpan tandatangan.
        </p>

        <div class="pvacts" v-if="isAdmin">
          <button class="pvbtn primary" id="pvAddSig" :disabled="busy"
                  @click="fileEl && fileEl.click()">
            {{ busy ? 'Memuat naik…' : (hasSignature ? 'Tukar tandatangan' : 'Tambah tandatangan') }}
          </button>
          <!-- Only when there is something to remove, so the row does not carry
               a permanently dead control. Behind a confirm: it is recoverable —
               a signature can be added again — but it sits beside a button
               pressed often and it changes what Sign does. Same reasoning as
               the Jadual delete (§3). -->
          <button v-if="hasSignature" class="pvbtn danger" id="pvRemoveSig" :disabled="busy"
                  @click="askRemove">
            Buang tandatangan
          </button>
          <input ref="fileEl" type="file" accept="image/*" id="pvSigFile"
                 style="display:none" @change="onPick">
        </div>

        <p v-if="error" class="pverr" id="pvErr">{{ error }}</p>
        <p v-else-if="saved" class="pvok" id="pvOk">Tandatangan disimpan ✓</p>
      </div>

      <div class="pvcard">
        <div class="pvacts">
          <button class="pvbtn danger" id="pvSignOut" @click="emit('signOut')">Sign out</button>
        </div>
      </div>

    </div>
  </div>
</template>
