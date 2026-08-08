<script setup>
import { ref, computed, watch, onMounted, onBeforeUnmount, nextTick } from 'vue';
import { SECTIONS, SEC_ORDER, cardCount, padToCards, emptyRow } from '../stores/records-logic.js';
import { addPrintSigs } from '../lib/signature-print.js';

/* KAD REKOD PILI BOMBA.
 *
 * docs/KAD-REKOD.md is BINDING and must be read before changing anything here.
 * This is a mandatory record under MS ISO 9001:2015 procedure PS-8. If a change
 * alters what comes out of the printer it needs the officer's approval BEFORE
 * it ships, not after.
 *
 * ── The three rules that are invisible on screen ─────────────────────────
 *
 * 1. ONE CARD IS EXACTLY TWO PAGES. Page 1 = header + Kerosakan + Pemantauan;
 *    page 2 = Pengujian + Kompaun. Never one, never three. Row heights are in
 *    millimetres in kad-rekod.css because 22 rows plus ~75mm of chrome has to
 *    land inside 259mm of usable height. Changing a height, a font size or a
 *    capacity can silently push the card onto a third sheet. Render to PDF and
 *    COUNT — the screen will not tell you.
 *
 * 2. THE RENDER LOOP STAYS CHRONOLOGICAL. Screen shows the newest card first
 *    only because `.fsheet{flex-direction:column-reverse}` flips it in CSS;
 *    print restores `column`. Reversing the loop here would reverse the paper
 *    too and break `.fpage.pb{page-break-before:always}` — and that failure is
 *    completely invisible until someone files the printout.
 *
 * 3. CARD NUMBERS ARE PERMANENT AND CHRONOLOGICAL. The oldest card is always
 *    Kad 1. A card signed and filed as Kad 2 must still be Kad 2 next year.
 *    Numbering by screen position was considered and rejected: it renumbers
 *    signed cards, and with print oldest-first the printed stack would count
 *    DOWN. `TERKINI` marks the newest instead, and is hidden in print.
 *
 * ── Signatures ───────────────────────────────────────────────────────────
 *
 * Signing is per ROW, never per card, and only Kerosakan / Pemantauan /
 * Pengujian have a T.T column. **A signed row is permanent** — it cannot be
 * edited, cleared or deleted by anyone including an admin, enforced here, in
 * RLS, and in a database trigger. This component's job is only the first of
 * those three, and it is the weakest: it is courtesy, not the control.
 *
 * `_sig` is the durable reference (a storage path, or a legacy public URL on
 * rows signed before the bucket was locked down). `_sigUrl` is a short-lived
 * signed link resolved per viewing and never persisted — which is also why
 * `formFingerprint` excludes it, or every card would look changed.
 */
const props = defineProps({
  hydrant: { type: Object, required: true },
  form: { type: Object, required: true },
  isAdmin: { type: Boolean, default: false },
  lastEdit: { type: Object, default: null },      // { at, by } — stamped by the database
  cloudNote: { type: String, default: '' },
  pending: { type: Object, default: null },
});
const emit = defineEmits(['close', 'save', 'edit', 'sign', 'dropPending']);

const root = ref(null);

// Every section always holds an exact multiple of its perPage count, so card N
// shows rows [N*perPage, +perPage). Padding is applied to the object the parent
// owns, exactly as V1 does, so growth and rendering never disagree.
const cards = computed(() => {
  const n = cardCount(props.form);
  padToCards(props.form, n);
  return n;
});

function rowsOf(sec, card) {
  const per = SECTIONS[sec].perPage;
  const from = card * per;
  const out = [];
  for (let i = from; i < from + per; i++) out.push({ i, r: (props.form[sec] || [])[i] || emptyRow(sec) });
  return out;
}

function fmtDMY(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  if (isNaN(d.getTime())) return iso;
  const p = (n) => String(n).padStart(2, '0');
  return p(d.getDate()) + '/' + p(d.getMonth() + 1) + '/' + d.getFullYear();
}
const today = () => new Date().toISOString().split('T')[0];

const editedLine = computed(() => {
  const e = props.lastEdit;
  if (!e || !e.at) return '';
  const d = new Date(e.at);
  const p = (n) => String(n).padStart(2, '0');
  const when = isNaN(d.getTime()) ? e.at
    : p(d.getDate()) + '/' + p(d.getMonth() + 1) + '/' + d.getFullYear() + ' ' + p(d.getHours()) + ':' + p(d.getMinutes());
  return 'Dikemas kini ' + when + (e.by ? ' oleh ' + e.by : '');
});

function onCell(sec, i, k, v) { emit('edit', { section: sec, row: i, key: k, value: v }); }
function onHeader(k, v) { emit('edit', { section: 'header', key: k, value: v }); }

/* The print copy is built AFTER the DOM settles, and again on every redraw,
 * because a card can gain a signature from another device while it is open. */
function refreshPrintSigs() { nextTick(() => addPrintSigs(root.value)); }
onMounted(() => {
  // V1 hides everything except the overlay when printing, via a body class.
  document.body.classList.add('form-open');
  refreshPrintSigs();
});
onBeforeUnmount(() => document.body.classList.remove('form-open'));
watch(() => props.form, refreshPrintSigs, { deep: true });
</script>

<template>
  <!-- TELEPORTED TO <body>, and that is not a detail.
       V1's print rule is `body.form-open > *:not(#formOverlay){display:none}`,
       which hides everything except the card. In V2 the component naturally
       renders inside #app — so #formOverlay is a GRANDchild of body, `#app`
       matches the rule, and the entire card is display:none on paper. It
       printed one blank sheet. Nothing on screen changes, and nothing in the
       PDF looks wrong: it just is not there.

       Caught by counting pages in a rendered PDF, which is why that assertion
       exists (docs/KAD-REKOD.md §6). The fix is to match V1's DOM position, NOT
       to edit the print CSS to suit a new structure — the CSS is the part that
       has been proven on paper. -->
  <Teleport to="body">
  <div id="formOverlay" ref="root">
    <div class="ftoolbar">
      <div class="ftitle">
        Kad Rekod Pili Bomba — <b>{{ hydrant.label }}</b>
        <span id="cloudStat" class="cloudstat" :class="{ hide: !cloudNote }">{{ cloudNote }}</span>
        <span v-if="editedLine" class="flastedit">{{ editedLine }}</span>
      </div>
      <div class="factions">
        <button class="fbtn" id="fSave" @click="emit('save')">Save</button>
        <button class="fbtn" id="fPrint" @click="() => { refreshPrintSigs(); setTimeout(() => window.print(), 60); }">Print</button>
        <button class="fbtn ghost" id="fClose" @click="emit('close')">Close</button>
      </div>
    </div>

    <!-- Cloud wins on a contested row, but the officer is SHOWN what they typed
         so they can put it back. Silently picking a winner is what caused the
         data loss in §4.10 in the first place. Hidden in print. -->
    <div v-if="pending && pending.items && pending.items.length" id="fPending" class="fpending">
      <b>Belum dihantar ke pelayan.</b> Baris di bawah telah diubah oleh peranti lain,
      jadi salinan pelayan yang dipaparkan. Ini yang anda taip semasa di luar talian —
      sila masukkan semula jika masih perlu:
      <ul><li v-for="(it, ix) in pending.items" :key="ix" v-html="it"></li></ul>
      <button class="fbtn ghost" id="fPendDrop" type="button" @click="emit('dropPending')">Buang salinan ini</button>
    </div>

    <!-- CHRONOLOGICAL. The screen flip is CSS (.fsheet{column-reverse}); print
         restores column. Never reverse this loop — see the header comment. -->
    <div class="fsheet">
      <div class="fcard" v-for="c in cards" :key="c">
        <div class="fpage" :class="{ pb: c - 1 > 0 }">
          <div class="fpage-top">Lampiran 5 <span class="krpb">KRPB</span>
            <span class="kadno">Kad {{ c }}/{{ cards }}</span>
            <span v-if="c === cards" class="terkini">TERKINI</span>
          </div>
          <div class="fcardtitle">KAD REKOD PILI BOMBA</div>

          <!-- Repeated on page 1 of EVERY card: a card must be readable on its
               own once detached from the others. -->
          <div class="fhdr">
            <div class="fhdr-l">
              <div class="frow"><label>No. Pili</label><span style="flex:1;font-weight:700">: {{ hydrant.label }}</span></div>
              <div class="frow"><label>Lokasi</label><span>:</span>
                <input class="fin-h" data-hk="lokasi" :value="form.header.lokasi || ''"
                       @input="onHeader('lokasi', $event.target.value)"></div>
              <div class="frow"><label>Jenis</label><span style="flex:1;font-weight:700">: PH</span></div>
              <div class="frow"><label>Tarikh Pasang</label><span>:</span>
                <input class="fin-h fin-date" type="date" :max="today()" data-hk="tarikh_pasang"
                       :value="form.header.tarikh_pasang || ''" @input="onHeader('tarikh_pasang', $event.target.value)">
                <span class="fin-print fin-print-h">{{ fmtDMY(form.header.tarikh_pasang || '') }}</span></div>
            </div>
            <div class="fhdr-r">
              <div class="fteman-t">TEMAN PILI BOMBA</div>
              <div class="frow"><label style="width:82px">No. Keahlian</label><span>:</span>
                <input class="fin-h" data-hk="no_keahlian" :value="form.header.no_keahlian || ''"
                       @input="onHeader('no_keahlian', $event.target.value)"></div>
              <div class="frow"><label style="width:82px">Tarikh Daftar</label><span>:</span>
                <input class="fin-h" data-hk="tarikh_daftar" :value="form.header.tarikh_daftar || ''"
                       @input="onHeader('tarikh_daftar', $event.target.value)"></div>
              <div class="fteman-b">PILI BOMBA: AWAM / SWASTA</div>
            </div>
          </div>

          <template v-for="sec in ['kerosakan', 'pemantauan']" :key="sec">
            <div class="fsec-title">{{ SECTIONS[sec].title }}</div>
            <table class="ftab" :class="sec">
              <thead v-html="SECTIONS[sec].thead"></thead>
              <tbody>
                <tr v-for="{ i, r } in rowsOf(sec, c - 1)" :key="i" :class="{ rowsigned: r._signed }">
                  <td v-for="col in SECTIONS[sec].cols" :key="col.k">
                    <!-- A signed row is PERMANENT. Disabled here, refused by
                         RLS, and blocked by a trigger — three independent
                         places, of which this is the weakest. -->
                    <template v-if="col.t === 'sign'">
                      <img v-if="r._signed && r._sigUrl" class="sigimg" :src="r._sigUrl" alt="T.T">
                      <!-- The link is still resolving. A quiet placeholder, NOT
                           an <img> pointing at the stored path: on a private
                           bucket that is a dead URL, and a broken-image icon on
                           a signed row looks like the signature has been lost. -->
                      <span v-else-if="r._signed && r._sig" class="sigwait" :data-sig-sec="sec" :data-sig-row="i">T.T</span>
                      <span v-else-if="r._signed" class="sigimg" style="font-size:9px;color:#166534">SIGNED</span>
                      <button v-else class="sigbtn" :data-sec="sec" :data-row="i"
                              title="Lampirkan tandatangan (admin)" @click="emit('sign', { section: sec, row: i })">+ T.T</button>
                    </template>
                    <template v-else-if="col.t === 'date'">
                      <input class="fin fin-date" type="date" :max="today()" :data-sec="sec" :data-row="i" :data-k="col.k"
                             :value="r[col.k] || ''" :readonly="!!r._signed" :disabled="!!r._signed"
                             @input="onCell(sec, i, col.k, $event.target.value)">
                      <span class="fin-print">{{ fmtDMY(r[col.k] || '') }}</span>
                    </template>
                    <input v-else class="fin" type="text" :data-sec="sec" :data-row="i" :data-k="col.k"
                           :value="r[col.k] || ''" :readonly="!!r._signed" :disabled="!!r._signed"
                           @input="onCell(sec, i, col.k, $event.target.value)">
                  </td>
                </tr>
              </tbody>
            </table>
          </template>
        </div>

        <div class="fpage pb">
          <template v-for="sec in ['pengujian', 'kompaun']" :key="sec">
            <div class="fsec-title">{{ SECTIONS[sec].title }}</div>
            <table class="ftab" :class="sec">
              <thead v-html="SECTIONS[sec].thead"></thead>
              <tbody>
                <tr v-for="{ i, r } in rowsOf(sec, c - 1)" :key="i" :class="{ rowsigned: r._signed }">
                  <td v-for="col in SECTIONS[sec].cols" :key="col.k">
                    <template v-if="col.t === 'sign'">
                      <img v-if="r._signed && r._sigUrl" class="sigimg" :src="r._sigUrl" alt="T.T">
                      <span v-else-if="r._signed && r._sig" class="sigwait" :data-sig-sec="sec" :data-sig-row="i">T.T</span>
                      <span v-else-if="r._signed" class="sigimg" style="font-size:9px;color:#166534">SIGNED</span>
                      <button v-else class="sigbtn" :data-sec="sec" :data-row="i"
                              title="Lampirkan tandatangan (admin)" @click="emit('sign', { section: sec, row: i })">+ T.T</button>
                    </template>
                    <template v-else-if="col.t === 'date'">
                      <input class="fin fin-date" type="date" :max="today()" :data-sec="sec" :data-row="i" :data-k="col.k"
                             :value="r[col.k] || ''" :readonly="!!r._signed" :disabled="!!r._signed"
                             @input="onCell(sec, i, col.k, $event.target.value)">
                      <span class="fin-print">{{ fmtDMY(r[col.k] || '') }}</span>
                    </template>
                    <input v-else class="fin" type="text" :data-sec="sec" :data-row="i" :data-k="col.k"
                           :value="r[col.k] || ''" :readonly="!!r._signed" :disabled="!!r._signed"
                           @input="onCell(sec, i, col.k, $event.target.value)">
                  </td>
                </tr>
              </tbody>
            </table>
          </template>
        </div>
      </div>
    </div>
  </div>
  </Teleport>
</template>
