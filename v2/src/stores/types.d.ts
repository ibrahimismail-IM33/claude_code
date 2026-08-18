// Shared JSDoc shapes for the pure *-logic.js files. Ambient types only — this
// .d.ts emits nothing and is never bundled; it exists so `@ts-check` on the
// logic modules can describe the data they pass around in one place instead of
// repeating typedefs file by file. Loose on purpose (most fields optional): the
// logic guards missing values everywhere, and the goal is to catch real slips
// (undefined access, wrong property, bad arity), not to model every row exactly.

/** A hydrant as the register/app holds it. Zone is DERIVED from `label`, never a field (CLAUDE.md §3). */
export interface Hydrant {
  id?: number;
  label?: string;
  status?: string;        // 'kerajaan' (Awam) | 'swasta' (Swasta)
  location?: string;
  lastInspected?: string; // ISO date, or '' when none
  district?: string;
  lat?: number;
  lng?: number;
}

/** One row of the "Nombor Pili Terkini" zone panel. min/max/count are built first; first/last/gap are added after. */
export interface ZoneEntry {
  zone: string;
  min: number;
  max: number;
  count: number;
  first?: string;
  last?: string;
  gap?: boolean;
}

/** The three filter axes that stack with AND (search is handled separately). */
export interface FilterState {
  status?: string | null;
  insp?: string | null;
  zone?: string | null;
  query?: string;
}

/** Awam/Swasta totals over the whole register. */
export interface Counts {
  kerajaan: number;
  swasta: number;
}
