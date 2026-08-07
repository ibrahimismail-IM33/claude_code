import { defineStore } from 'pinia';
import { blankForm, normalizeForm, cardCount, padToCards,
         needsNewCard as needsNewCardFor,
         formFingerprint, latestPengujianDate } from './records-logic.js';

export * from './records-logic.js';

const formKey = (id) => 'bbpkunak_form_' + id;

export const useRecordsStore = defineStore('records', {
  state: () => ({
    // The form currently open, and the fingerprint of what is drawn, so a cloud
    // copy identical to the screen does not cause a second draw. The card used
    // to redraw on every open — cache first, cloud second — which reads as a
    // blink on a phone.
    form: null,
    drawnFingerprint: '',
  }),

  getters: {
    cards: (s) => (s.form ? cardCount(s.form) : 1),
  },

  actions: {
    load(id) {
      try {
        const raw = window.localStorage.getItem(formKey(id));
        if (raw) { const d = JSON.parse(raw); if (d && d.header) return normalizeForm(d); }
      } catch (e) { /* unreadable cache — start from a blank card */ }
      return blankForm();
    },

    // Writes local storage BEFORE the network is attempted, so an officer with
    // no signal still keeps their typing and still gets their next card.
    saveLocal(id, f) {
      try { window.localStorage.setItem(formKey(id), JSON.stringify(f)); } catch (e) { /* full or blocked */ }
    },

    // Aliased on import: a method named needsNewCard calling a bare
    // needsNewCard() would resolve to the import only by lexical accident.
    needsNewCard(f) { return needsNewCardFor(f); },

    grow(f) {
      return padToCards(f, cardCount(f) + 1);
    },

    // Only redraw when the cloud copy actually differs from what is on screen.
    changedFromDrawn(f) {
      return formFingerprint(f) !== this.drawnFingerprint;
    },

    markDrawn(f) {
      this.drawnFingerprint = formFingerprint(f);
    },

    // "" once no dated Pengujian row remains, which CLEARS the pin's badge —
    // returning early on a blank used to leave the map advertising an
    // inspection the record no longer held.
    lastInspected(f) {
      return latestPengujianDate(f);
    },
  },
});
