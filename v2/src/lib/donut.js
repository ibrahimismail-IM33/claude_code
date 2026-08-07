/* The 3D donut. A VERBATIM port of index.html — do not tidy it.
 *
 * This is an oblique projection: a point at (radius r, angle a, depth z) lands
 * at x = CX + r*K*cos(a) + z, y = CY + r*sin(a). The extrusion is real
 * geometry — top face, outer and inner walls, and the two cut faces — not a
 * drop shadow pretending to be depth.
 *
 * Two things here look like they could be simplified and cannot:
 *
 *   - Face VISIBILITY is derived, never guessed. Outer wall where cos(a) > 0,
 *     inner wall where cos(a) < 0, start cap where sin(a0) > 0, end cap where
 *     sin(a1) < 0. Guessing produces phantom faces at particular data splits —
 *     splits that only appear with real inspection data.
 *   - The segment GAP scales with slice width. A fixed 5° gap swallowed any
 *     category under about 2%, so "Diperiksa" at 1.2% vanished from the chart
 *     entirely (CLAUDE.md §4.4).
 *
 * Draw order is caps → walls → top faces (painter's algorithm), and the
 * viewBox sizes to the labels actually drawn, because with two labels on one
 * side the second used to fall outside it (§4.5).
 *
 * Guarded by tests/v2-donut-parity.js, which compares the whole emitted SVG
 * string against V1's for many data splits. Exact string equality is the point:
 * a path that differs by one control point is a rendering defect nobody will
 * notice until it looks wrong on a phone.
 */

export const SEG = [
  { key: 'ok',   label: 'Diperiksa',       t1: '#FDF0D5', t2: '#E8D6B2', s1: '#B9A57F', s2: '#8A7A5C', ink: '#FDF0D5' },
  { key: 'wait', label: 'Belum di-sign',   t1: '#7FB0CE', t2: '#5C90B0', s1: '#42708C', s2: '#2C4E63', ink: '#9FC6DF' },
  { key: 'none', label: 'Belum diperiksa', t1: '#0A4A6B', t2: '#003049', s1: '#002438', s2: '#001624', ink: '#9CAAB6' },
];

export const DCX = 250, DCY = 190, DR = 138, DRI = 138 * 0.60,
             DK = 0.70, DDEP = 16, DSTART = -90, DGAP = 5, DSTEP = 2;

function dpt(a, r, dx) {
  const t = a * Math.PI / 180;
  return [DCX + r * DK * Math.cos(t) + (dx || 0), DCY + r * Math.sin(t)];
}
function dsamples(a0, a1, r, dx) {
  const n = Math.max(2, Math.ceil(Math.abs(a1 - a0) / DSTEP)), out = [];
  for (let i = 0; i <= n; i++) out.push(dpt(a0 + (a1 - a0) * i / n, r, dx));
  return out;
}
function dpoly(p) { return p.map((q, i) => (i ? 'L' : 'M') + q[0].toFixed(2) + ' ' + q[1].toFixed(2)).join(' '); }
function dface(a0, a1) { return dpoly(dsamples(a0, a1, DR, 0).concat(dsamples(a1, a0, DRI, 0))) + ' Z'; }
function dwall(a0, a1, r) { return dpoly(dsamples(a0, a1, r, 0).concat(dsamples(a1, a0, r, DDEP))) + ' Z'; }
function dcap(a) { return dpoly([dpt(a, DRI, 0), dpt(a, DR, 0), dpt(a, DR, DDEP), dpt(a, DRI, DDEP)]) + ' Z'; }
function dband(a0, a1, lo, hi) {
  const out = [];
  for (let k = -2; k <= 2; k++) {
    const s = Math.max(a0, lo + 360 * k), e = Math.min(a1, hi + 360 * k);
    if (e > s + 0.05) out.push([s, e]);
  }
  return out;
}
function dsin(a) { return Math.sin(a * Math.PI / 180); }
function dcos(a) { return Math.cos(a * Math.PI / 180); }

// A fixed gap would swallow a small slice whole — with real data a category can
// easily be 1% (4 degrees). Shrink the gap for narrow slices so every non-zero
// category still draws.
function gapFor(frac) { return Math.min(DGAP, frac * 360 * 0.35); }

function esc(s) {
  return String(s == null ? '' : s).replace(/[&<>"]/g, (m) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[m]));
}

export function buildDonut(d, sweep) {
  if (sweep === undefined) sweep = 1;
  const lim = DSTART + 360 * sweep, t = d.total || 1, vals = [d.ok, d.wait, d.none];
  let defs = '', body = '', faces = '', leads = '';
  const meta = [];
  let a = DSTART;

  SEG.forEach((s, i) => {
    const frac = vals[i] / t, a0 = a, a1 = a + frac * 360; a = a1;
    defs += '<linearGradient id="dtf' + s.key + '" x1="0" y1="0" x2="1" y2=".4">'
         + '<stop offset="0" stop-color="' + s.t1 + '"/><stop offset="1" stop-color="' + s.t2 + '"/></linearGradient>'
         + '<linearGradient id="dsw' + s.key + '" x1="0" y1="0" x2="1" y2="0">'
         + '<stop offset="0" stop-color="' + s.s1 + '"/><stop offset="1" stop-color="' + s.s2 + '"/></linearGradient>'
         + '<linearGradient id="dcp' + s.key + '" x1="0" y1="0" x2="1" y2="0">'
         + '<stop offset="0" stop-color="' + s.t2 + '"/><stop offset="1" stop-color="' + s.s1 + '"/></linearGradient>';
    const gp = gapFor(frac), d0 = a0 + gp / 2, d1 = a1 - gp / 2;
    if (d1 > d0 + 0.2 && d0 < lim) meta.push({ s, d0, d1, e1: Math.min(d1, lim), frac, val: vals[i] });
  });

  const seg = (key, dd, fill, extra) =>
    '<path class="seg3d hit" data-key="' + key + '" d="' + dd + '" fill="' + fill + '"' + (extra || '') + '/>';

  meta.forEach((m) => {
    if (dsin(m.d0) > 0) body += seg(m.s.key, dcap(m.d0), 'url(#dcp' + m.s.key + ')');
    if (dsin(m.e1) < 0) body += seg(m.s.key, dcap(m.e1), 'url(#dcp' + m.s.key + ')');
  });
  meta.forEach((m) => {
    dband(m.d0, m.e1, -90, 90).forEach((b) => { body += seg(m.s.key, dwall(b[0], b[1], DR), 'url(#dsw' + m.s.key + ')'); });
    dband(m.d0, m.e1, 90, 270).forEach((b) => { body += seg(m.s.key, dwall(b[0], b[1], DRI), 'url(#dsw' + m.s.key + ')', ' opacity=".9"'); });
  });
  meta.forEach((m) => {
    faces += seg(m.s.key, dface(m.d0, m.e1), 'url(#dtf' + m.s.key + ')', ' stroke="rgba(255,255,255,.22)" stroke-width=".8"');
  });

  // labels laid out from the full set so they never shift while the ring grows
  const left = [], right = [];
  let a2 = DSTART;
  SEG.forEach((s, i) => {
    const frac = vals[i] / t, a0 = a2, a1 = a2 + frac * 360; a2 = a1;
    if (frac <= 0) return;
    const mid = (a0 + a1) / 2, d1 = a1 - gapFor(frac) / 2;
    const m = { s, frac, val: vals[i], dot: dpt(mid, (DR + DRI) / 2, 0),
      out: dpt(mid, DR + 12, dcos(mid) >= 0 ? DDEP : 0),
      op: Math.max(0, Math.min(1, (lim - d1) / 10)) };
    m.y = m.out[1];
    (dcos(mid) >= 0 ? right : left).push(m);
  });
  function spread(l) {
    l.sort((x, y) => x.y - y.y);
    for (let i = 1; i < l.length; i++) if (l[i].y - l[i - 1].y < 54) l[i].y = l[i - 1].y + 54;
    return l;
  }
  spread(left); spread(right);
  const railR = DCX + DR * DK + DDEP + 26, railL = DCX - DR * DK - 26;
  let minY = DCY - DR - 10, maxY = DCY + DR + 10;
  function emit(m, isRight) {
    const railX = isRight ? railR : railL, tx = isRight ? railX + 6 : railX - 6;
    const anchor = isRight ? 'start' : 'end', y = m.y;
    minY = Math.min(minY, y - 26); maxY = Math.max(maxY, y + 24);
    if (m.op <= 0) return;
    leads += '<g class="labg k-' + m.s.key + '" data-key="' + m.s.key + '" tabindex="0" role="button" '
          + (m.op < 1 ? 'opacity="' + m.op.toFixed(2) + '" ' : '')
          + 'aria-label="' + m.s.label + ' ' + m.val + ' pili">'
          + '<path class="leadline" d="M' + m.dot[0].toFixed(1) + ' ' + m.dot[1].toFixed(1)
          + ' L' + m.out[0].toFixed(1) + ' ' + m.out[1].toFixed(1)
          + ' L' + railX.toFixed(1) + ' ' + y.toFixed(1) + '"/>'
          + '<circle class="leaddot" cx="' + m.dot[0].toFixed(1) + '" cy="' + m.dot[1].toFixed(1) + '" r="3.4"/>'
          + '<text class="pc3" x="' + tx.toFixed(1) + '" y="' + (y - 3).toFixed(1) + '" text-anchor="' + anchor + '">' + (m.frac * 100).toFixed(1) + '%</text>'
          + '<text class="nm3" x="' + tx.toFixed(1) + '" y="' + (y + 15).toFixed(1) + '" text-anchor="' + anchor + '" fill="' + m.s.ink + '">' + m.s.label + '</text>'
          + '</g>';
  }
  right.forEach((m) => { emit(m, true); });
  left.forEach((m) => { emit(m, false); });

  return '<svg viewBox="0 ' + minY.toFixed(0) + ' 520 ' + (maxY - minY).toFixed(0) + '" '
    + 'role="img" aria-label="Carta donat status pemeriksaan">'
    + '<defs>' + defs
    + '<linearGradient id="dsheen" x1="0" y1="0" x2="1" y2=".3">'
    + '<stop offset="0" stop-color="#fff" stop-opacity=".20"/>'
    + '<stop offset=".6" stop-color="#fff" stop-opacity="0"/></linearGradient></defs>'
    + body + faces
    + (sweep > 0.01 ? '<path d="' + dface(DSTART, Math.min(lim, DSTART + 359.99)) + '" fill="url(#dsheen)" pointer-events="none"/>' : '')
    + '<text class="center-n" x="' + DCX + '" y="' + (DCY - 2) + '" text-anchor="middle">' + Math.round(d.total * sweep) + '</text>'
    + '<text class="center-l" x="' + DCX + '" y="' + (DCY + 17) + '" text-anchor="middle">JUMLAH PILI</text>'
    + leads + '</svg>';
}

export { esc };
