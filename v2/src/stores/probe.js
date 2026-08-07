import { defineStore } from 'pinia';

// CSP probe store — not part of V2 proper.
//
// It exists to prove that a real Pinia store with a derived getter survives
// `script-src 'self'`, because that is the shape Phase 1 needs: filters that
// stack with AND in ONE getter (CLAUDE.md §3), not three lists mutating each
// other. If reactivity needed `eval` this is where it would show up.
export const useProbe = defineStore('probe', {
  state: () => ({
    rows: [
      { label: 'A01', status: 'kerajaan' },
      { label: 'A02', status: 'kerajaan' },
      { label: 'A26', status: 'swasta' },
      { label: 'B01', status: 'kerajaan' },
    ],
    status: null,
    zone: null,
  }),
  getters: {
    visible(s) {
      let list = s.rows;
      if (s.status) list = list.filter((r) => r.status === s.status);
      if (s.zone) list = list.filter((r) => r.label.charAt(0) === s.zone);
      return list;
    },
  },
});
