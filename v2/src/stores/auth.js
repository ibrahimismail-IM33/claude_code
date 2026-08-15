import { defineStore } from 'pinia';

/* Session and role.
 *
 * Deliberately thin, and deliberately without a parity suite: unlike the other
 * four stores this holds no decision worth getting wrong. Everything V1's
 * applyRoleUI does is DOM toggling, which becomes ordinary template bindings in
 * Phases 2-4 and is covered there. Writing a parity test for `role === 'admin'`
 * would be ceremony, and a suite full of ceremony makes the ones that matter
 * harder to take seriously.
 *
 * The one rule that IS load-bearing: **the client's idea of the role is a UI
 * convenience and nothing else.** Every write is authorised by RLS in the
 * database, evaluated as the calling role. Hiding a button is courtesy; it is
 * not the control. A V2 that forgets this could "grant" admin by flipping a
 * ref, and the database would still — correctly — refuse every write.
 *
 * Fail closed: every error path resolves to 'viewer', never to admin.
 */
export const useAuthStore = defineStore('auth', {
  state: () => ({
    email: '',
    role: 'viewer',
    // The officer's home district (multi-district foundation, PRD §7.3). Every
    // query is scoped to it and every write stamps it. Defaults to KUNAK — the
    // only district today — and, like role, fails closed to that default on any
    // error so a read failure can never silently widen scope to another
    // district. There is no UI to change it: it is a fact about the account.
    district: 'KUNAK',
    ready: false,
  }),

  getters: {
    isAdmin: (s) => s.role === 'admin',
    // Viewers cannot add hydrants or edit records. The server enforces it; this
    // only decides what is worth showing.
    canWrite: (s) => s.role === 'admin',
  },

  actions: {
    async fetchRole(sb) {
      if (!sb) return 'viewer';
      try {
        const u = await sb.auth.getUser();
        const user = u && u.data && u.data.user;
        if (!user) return 'viewer';
        this.email = user.email || '';
        const res = await sb.from('profiles').select('role, district').eq('id', user.id).single();
        if (res && !res.error && res.data) {
          // Fail closed to KUNAK if the column is absent/null (a pre-migration
          // profile), never to nothing — an empty district must not read as
          // "matches no district" and silently strand the officer.
          this.district = res.data.district || 'KUNAK';
          if (res.data.role) return res.data.role;
        }
        return 'viewer';
      } catch (e) {
        return 'viewer';
      }
    },

    async enter(sb) {
      this.role = await this.fetchRole(sb);
      this.ready = true;
      return this.role;
    },

    signOut() {
      this.email = '';
      this.role = 'viewer';
      this.district = 'KUNAK';
      this.ready = false;
    },
  },
});
