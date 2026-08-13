<script setup>
import { ref } from 'vue';

/* The login gate.
 *
 * It sits at z-index 100000 — above modals (9999) and the record form (12000)
 * — because a gate something can paint over is not a gate. That number lives
 * in shell.css and is part of the ladder §4.8 was about.
 *
 * Two rules carry more weight than the markup:
 *
 *  - THE GATE IS NOT THE SECURITY CONTROL. Every read and every write is
 *    authorised by RLS in the database, evaluated as the calling role. This
 *    only decides what is worth showing. A V2 that "let someone in" by
 *    flipping a ref would still be refused every row by Postgres — which is
 *    the design, and why hiding the gate is never a vulnerability by itself.
 *  - The error text stays vague about WHICH half was wrong. "Wrong email or
 *    password" tells an attacker nothing about whether an account exists;
 *    V1 does the same and it is worth not losing in translation.
 *
 * Accounts are created by the administrator — there is deliberately no sign-up
 * and no password reset here. Officers each have their own login because
 * signatures record who signed, which is meaningless on a shared account.
 */
// The same crest the header uses. One import, one emitted file, one cache
// entry — and it cannot drift from the header's the way a second copy would.
import logo from '../assets/logo.png';

defineProps({
  busy: { type: Boolean, default: false },
  error: { type: String, default: '' },
});
const emit = defineEmits(['signIn']);

const email = ref('');
const pass = ref('');

/* Reveal the password.
 *
 * Officers type this on a phone, one-handed, sometimes in gloves and often in
 * sun where the dots are hard to count — and a wrong password here says only
 * "Wrong email or password", deliberately, so there is no other way to tell a
 * typo from a real failure.
 *
 * Defaults to HIDDEN, and stays a per-attempt choice: nothing remembers it, so
 * a shared or borrowed device never opens with the password already on screen.
 */
const showPass = ref(false);

function submit() {
  emit('signIn', { email: email.value.trim(), password: pass.value, clear: () => { pass.value = ''; } });
}
</script>

<template>
  <div id="authGate">
    <div class="authbox">
      <!-- The crest and the wordmark, from the redesign mockup.
           `.authlogo` was already in V1's stylesheet and never rendered — a
           rule with no markup, sitting in parity-waivers.json as dead. V1
           meant to put the crest here and never did; this is that rule finally
           doing its job, so the waiver goes.
           The wordmark reads "e-Pili Bomba", matching the header's h1: the app
           is one product and the login is not a different brand (§10). -->
      <img class="authlogo" :src="logo" alt="Jabatan Bomba dan Penyelamat Malaysia">
      <h2 id="authWordmark" style="text-align:center;margin-bottom:2px">e-Pili Bomba</h2>
      <div class="sub" style="text-align:center">BBP Kunak</div>
      <p style="text-align:center;color:rgba(255,255,255,.45);font-size:12px;margin-bottom:6px">Sign in to continue</p>

      <label for="authEmail">Email</label>
      <input id="authEmail" v-model="email" type="email" autocomplete="username" inputmode="email"
             placeholder="nama@contoh.com" @keydown.enter="submit" />

      <label for="authPass">Password</label>
      <div class="authpwrap">
        <!-- `:type` is bound, NOT a class swap on the icon: the input's own
             type is the only thing that actually masks the field, and an icon
             that changes while the dots stay put is the failure worth catching.
             The test asserts the type for that reason. -->
        <input id="authPass" v-model="pass" :type="showPass ? 'text' : 'password'"
               autocomplete="current-password"
               placeholder="••••••••" @keydown.enter="submit" />
        <button type="button" class="autheye" id="authEye"
                :aria-pressed="String(showPass)"
                :aria-label="showPass ? 'Sembunyikan kata laluan' : 'Tunjukkan kata laluan'"
                :title="showPass ? 'Sembunyikan kata laluan' : 'Tunjukkan kata laluan'"
                @click="showPass = !showPass">
          <!-- Inline SVG, not an emoji or an icon font: it inherits currentColor,
               renders identically on every device, and adds no request. -->
          <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor"
               stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
            <path d="M2 12s3.6-6.5 10-6.5S22 12 22 12s-3.6 6.5-10 6.5S2 12 2 12Z" />
            <circle cx="12" cy="12" r="2.7" />
            <line v-if="showPass" x1="4" y1="20" x2="20" y2="4" />
          </svg>
        </button>
      </div>

      <button class="authbtn" id="authBtn" :disabled="busy" @click="submit">
        {{ busy ? 'Signing in…' : 'Sign In' }}
      </button>

      <div class="autherr" :class="{ hide: !error }" id="authErr">{{ error }}</div>

      <p style="margin-top:14px;font-size:11px;color:rgba(255,255,255,.3);text-align:center;line-height:1.5">
        Accounts are created by the administrator.<br>Contact BBP Kunak if you need access.
      </p>
    </div>
  </div>
</template>
