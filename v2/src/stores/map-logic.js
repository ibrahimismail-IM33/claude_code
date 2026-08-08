/* The map layer, as pure functions. Ported from index.html.
 *
 * Leaflet itself stays imperative behind v2/src/lib/leaflet.js — 187 markers
 * plus clustering driven through Vue's reactivity is slower than Leaflet's own
 * handling and buys nothing (docs/V2-ROADMAP.md, Phase 3). What lives here is
 * everything around it that can be decided without a map: the marker HTML, the
 * tooltip, and the fit rule.
 *
 * The fit rule is the one with consequence. Everything else here is markup.
 */

export const STATUS = {
  kerajaan: { label: 'Awam',   short: 'GOV', hex: '#ef4444', icon: '🏛️', blurb: 'Public / government-maintained unit' },
  swasta:   { label: 'Swasta', short: 'PVT', hex: '#facc15', icon: '🏢', blurb: 'Privately-maintained unit' },
};
export const ORDER = ['kerajaan', 'swasta'];

const pad = (n) => String(n).padStart(2, '0');

export function esc(s) {
  return String(s == null ? '' : s).replace(/[&<>"]/g, (m) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[m]));
}

export function fmtBadge(d) {
  if (!d) return '';
  const x = new Date(d);
  if (isNaN(x.getTime())) return d.slice(0, 10);
  return pad(x.getDate()) + '/' + pad(x.getMonth() + 1) + '/' + String(x.getFullYear()).slice(-2);
}

/* ---- the fit rule ----------------------------------------------------------
 *
 * The map re-fits its bounds when the set of visible hydrants CHANGES, keyed by
 * the sorted list of ids. Two things make this subtle, and both are decisions
 * rather than accidents (CLAUDE.md §3):
 *
 *  - A BACKGROUND pull must never re-fit. A pull that brings in a hydrant
 *    someone else just added changes the key, and re-fitting would jump the map
 *    away from whatever an officer is reading. `noFitOnce` is armed by the
 *    quiet path and consumed here: the key is recorded WITHOUT fitting, so the
 *    next genuine change still fits normally.
 *  - An empty result never fits. Fitting to nothing has no meaning, and the
 *    key is deliberately not recorded either, so the view is still correct once
 *    hydrants come back.
 *
 * Returned rather than performed, so the decision can be tested without a map.
 */
export function keyOf(visible) {
  return visible.map((h) => h.id).sort((a, b) => a - b).join(',');
}

export function fitDecision(visible, fittedKey, noFitOnce) {
  const key = keyOf(visible);
  if (noFitOnce) return { fit: false, fittedKey: key, noFitOnce: false };
  if (key !== fittedKey && visible.length) return { fit: true, fittedKey: key, noFitOnce: false };
  return { fit: false, fittedKey, noFitOnce: false };
}

/* ---- marker and tooltip markup ----
 * Copied from V1. The badge carries the last inspection date and the amber "!"
 * marks a card on this device that has not reached the server — an officer
 * should not have to open every pili to find what has not synced (§3). */
export function markerHtml(status, last, pending) {
  const color = STATUS[status].hex;
  const badge = last ? '<div class="hydrant-date-badge ' + status + '">' + fmtBadge(last) + '</div>' : '';
  const pend = pending ? '<div class="hydrant-pending" title="Belum dihantar ke pelayan">!</div>' : '';
  const svg = '<svg xmlns="http://www.w3.org/2000/svg" width="42" height="52" viewBox="0 0 42 52" style="position:absolute;left:0;top:0">'
    + '<ellipse cx="21" cy="50" rx="10" ry="3" fill="rgba(0,0,0,0.35)"/>'
    + '<rect x="14" y="34" width="14" height="10" rx="3" fill="' + color + '" stroke="white" stroke-width="1.5"/>'
    + '<rect x="11" y="18" width="20" height="18" rx="5" fill="' + color + '" stroke="white" stroke-width="1.5"/>'
    + '<rect x="13" y="12" width="16" height="8" rx="4" fill="' + color + '" stroke="white" stroke-width="1.5"/>'
    + '<rect x="4" y="22" width="8" height="5" rx="2.5" fill="' + color + '" stroke="white" stroke-width="1.5"/>'
    + '<rect x="30" y="22" width="8" height="5" rx="2.5" fill="' + color + '" stroke="white" stroke-width="1.5"/>'
    + '<circle cx="21" cy="10" r="4" fill="' + color + '" stroke="white" stroke-width="1.5"/>'
    + '<rect x="17" y="20" width="8" height="14" rx="3" fill="rgba(255,255,255,0.18)"/>'
    + '<ellipse cx="16" cy="22" rx="2" ry="4" fill="rgba(255,255,255,0.25)"/></svg>';
  return '<div class="hydrant-marker" style="--c:' + color + '">' + svg + '<span class="hydrant-beacon"></span>' + badge + pend + '</div>';
}

export const ICON_OPTS = { className: '', iconSize: [42, 74], iconAnchor: [21, 52], popupAnchor: [0, -62] };

export function tipHtml(h, pending) {
  const c = STATUS[h.status];
  return '<div style="display:flex;flex-direction:column;gap:2px"><div style="display:flex;align-items:center;gap:6px">'
    + '<span style="width:8px;height:8px;border-radius:9999px;background:' + c.hex + ';box-shadow:0 0 8px ' + c.hex + '"></span>'
    + '<span style="font-weight:800;letter-spacing:.02em">' + esc(h.label) + '</span>'
    + '<span style="font-family:\'JetBrains Mono\',monospace;font-size:10px;opacity:.6;margin-left:4px">' + c.short + '</span></div>'
    + '<div style="font-family:\'JetBrains Mono\',monospace;font-size:10px;opacity:.7">' + (h.lastInspected ? 'Inspected: ' + esc(h.lastInspected) : 'No inspection date') + '</div>'
    + (pending ? '<div style="font-family:\'JetBrains Mono\',monospace;font-size:10px;color:#fbbf24">! Belum dihantar ke pelayan</div>' : '') + '</div>';
}
