import { defineConfig } from 'vite';
import vue from '@vitejs/plugin-vue';

// V2 build config. See docs/V2-ROADMAP.md.
//
// The app ships under `script-src 'self'` with no CDN and no external origin
// (CLAUDE.md §3) — a third-party script would run with full access to the
// signed-in session and every record card. `tests/v2-csp.js` proves the built
// output holds that line; it asserts on the bundle, not on this file, so none
// of the settings below are trusted on their own.
//
// Measured on Vite 8.2.1 rather than assumed:
//
//   modulePreload.polyfill  Off. NOT a CSP requirement — Vite 8 keeps the
//                           polyfill inside the bundle and emits no inline
//                           script, verified with a real code split. It is off
//                           because officers are on modern mobile browsers and
//                           the polyfill is dead weight. If a future Vite goes
//                           back to injecting it inline, the inline-script
//                           assertion in the test is what will catch it.
//   cssCodeSplit            Off, so styles land in one predictable external
//                           file rather than being injected by JS. This matters
//                           more than it looks: the Kad Rekod print CSS is
//                           millimetre-tuned and must arrive as a stylesheet in
//                           a known source order (docs/KAD-REKOD.md).
//   assetsInlineLimit       0, so nothing is silently turned into a data: URI.
//
// The Vue build resolved here is the runtime-only one — no template compiler,
// so there is no `new Function` and the policy never needs 'unsafe-eval'.
// Do not import 'vue/dist/vue.esm-bundler.js' or enable a runtime compiler.
export default defineConfig({
  root: 'v2',
  plugins: [vue()],
  build: {
    outDir: '../dist',
    emptyOutDir: true,
    cssCodeSplit: false,
    assetsInlineLimit: 0,
    modulePreload: { polyfill: false },
  },
});
