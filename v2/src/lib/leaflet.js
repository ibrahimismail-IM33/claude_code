import * as LeafletModule from 'leaflet';

// The Leaflet seam. Same reasoning as lib/supabase.js — the suites stub
// `window.L` with a handful of no-ops so the map never has to render or fetch a
// tile, and V2 must keep working against that stub unedited.
//
// Note what is deliberately NOT here: any attempt to wrap markers in Vue
// components. 187 markers plus clustering driven through Vue's reactivity is
// slower than Leaflet's own handling and buys nothing, so Leaflet stays
// imperative behind this boundary for the whole migration (docs/V2-ROADMAP.md,
// Phase 3).
//
// leaflet.markercluster is a side-effect plugin: it attaches
// `markerClusterGroup` to the L it finds. Import it only alongside the real
// library, never over a stub, or it throws before the test can run.
export function getL() {
  const stub = typeof window !== 'undefined' && window.L;
  return stub || LeafletModule;
}

export async function loadCluster() {
  if (typeof window !== 'undefined' && window.L) return; // stubbed; nothing to attach
  window.L = LeafletModule;
  await import('leaflet.markercluster');
}
