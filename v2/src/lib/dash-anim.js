/* The dashboard entry animation — the thing that drives `sweep` from 0 to 1.
 *
 * WHAT `sweep` IS, because getting this wrong shipped a real bug
 *   It is a PROGRESS FRACTION in [0, 1], and it is multiplied straight into
 *   every displayed figure: lib/donut.js renders `Math.round(d.total * sweep)`
 *   and StatCards.vue renders `Math.round(data[k] * sweep)` and
 *   `(data[k] / total * 100 * sweep)`. So at sweep = 1 the numbers are the real
 *   ones, and at sweep = 0.4 they are four tenths of the way counted up.
 *
 *   V2 shipped with `App.vue` passing an incrementing COUNTER here instead —
 *   1 on the first open, 2 on the second, 8 on the eighth. The register of 203
 *   was displayed as 1624, and "Belum diperiksa" reported 705.4%. It read as
 *   correct on the first open, which is exactly why staging looked fine and
 *   why every suite passed: they all open the dashboard once.
 *
 *   Nothing was animating at all. This file is what was missing.
 *
 * Ported from V1 (index.html, "entry animation"), constants included:
 *   - 900ms, ease-out cubic — matches what officers already know;
 *   - TIME-BASED rather than per-frame, so a slow device draws FEWER frames
 *     rather than running the animation for longer (CLAUDE.md §6);
 *   - prefers-reduced-motion paints the final value immediately;
 *   - an in-flight run is cancelled before a new one starts, so re-opening the
 *     tab cannot leave two animations fighting over the same value.
 */

export const DANIM_MS = 900;

// Ease-out cubic. V1: 1-Math.pow(1-p,3).
export function ease(p) {
  return 1 - Math.pow(1 - p, 3);
}

export function prefersReducedMotion() {
  return typeof window !== 'undefined' && window.matchMedia
    ? window.matchMedia('(prefers-reduced-motion: reduce)').matches
    : false;
}

/* Animate 0 → 1, calling `onFrame(p)` each frame and once more with exactly 1.
 *
 * Returns a cancel function. Callers MUST call it before starting another run
 * — see the note above about two animations sharing one value.
 *
 * `onFrame` is always called with a value in [0, 1]. That invariant is the
 * whole point of this module and tests/v2-app-live.js asserts it.
 */
export function animateSweep(onFrame, opts = {}) {
  const ms = opts.duration || DANIM_MS;
  const raf = opts.raf || (typeof window !== 'undefined' && window.requestAnimationFrame);
  const cancelRaf = opts.cancelRaf || (typeof window !== 'undefined' && window.cancelAnimationFrame);
  const reduced = opts.reduced !== undefined ? opts.reduced : prefersReducedMotion();

  // No rAF (or the officer asked for less motion): show the real figures now.
  // Never leave them at 0 — a dashboard reading zero is a wrong dashboard.
  if (!raf || reduced) { onFrame(1); return () => {}; }

  let id = null, t0 = 0, done = false;
  const frame = (ts) => {
    if (!t0) t0 = ts;
    const p = Math.min(1, (ts - t0) / ms);
    if (p >= 1) { done = true; id = null; onFrame(1); return; }
    onFrame(ease(p));
    id = raf(frame);
  };
  id = raf(frame);

  return () => {
    if (done || id === null) return;
    if (cancelRaf) cancelRaf(id);
    id = null;
    // Land on the true figures rather than freezing part-counted. A cancelled
    // animation must never leave a number that is not the real one on screen.
    onFrame(1);
  };
}
