# e-Pili Bomba V2 — Vue 3 + Vite + Pinia

> **Status: approved plan, nothing built.** V1 (`index.html`) is what runs at
> epilibomba.com and is unaffected by anything in this document. No phase below
> has started. Agreed 2026-08-07.
>
> Integration branch: `claude/epb-v2`. **`main` stays V1 until cutover.**

## Context

`index.html` is 3,534 lines / 253 KB with ~150 functions in a single closure and
a **global** stylesheet where `.card`, `.btn` and `.pill` are already taken. Every
change is a whole-app change: §4.7 was a CSS source-order bug, §4.8 a stacking
context, §4.9 a table pushing the page sideways. The app works — but the cost of
each change is rising, and `docs/PRD.md` plans district expansion on top of it.

**The driver is maintainability, and only maintainability.** That is the single
most important scoping rule in this document:

> **V2 must be behaviourally identical to V1.** No new feature, no redesign, no
> "while we're in here". If an officer can tell V2 from V1 by looking, we have
> failed the brief and widened the blast radius for nothing.

Features wait for V2.1. PWA is explicitly out of scope.

### Decisions taken

| | |
|---|---|
| Migration | **Strangler** — screen by screen, each shipped; V1 keeps working throughout |
| Build | **Vite**, but the CSP discipline survives: fully self-hosted output, no CDN, no external origin |
| PWA | **Out of scope** |
| Driver | Maintainability |
| Branching | **A branch per phase**, landing on a long-lived `claude/epb-v2` |
| Release | **V2 is held back until complete** — `main` keeps publishing V1 throughout |

---

## The engineering-manager read

**The risk here is not Vue. It is that this app's bugs are not found by review.**
§4.10 (offline data destroyed), §4.13 (a row could never be cleared) and the
faded print signature were all found by a person *using* the thing — two of them
in the field, one on paper. A rewrite re-opens every one of those paths at once.
That is exactly why big-bang was rejected.

**What makes this migration tractable is the test suite.** Seven suites, 152
assertions, and they drive the *real UI in a real browser* rather than calling
functions. That makes them **framework-agnostic** — and it makes them the
migration contract:

> A migrated view is done when the existing suites pass against it **unchanged**.
> If a test needs editing to go green, that is a behaviour change, and behaviour
> changes are out of scope.

There is one caveat, and it is the first thing to fix (Phase 0): the suites stub
Supabase and Leaflet by assigning to `window`, and they find elements by the DOM
ids the current file happens to emit. Both need to be a deliberate seam before
any view moves, or every suite breaks on the first migration and we lose the only
safety net we have.

**Ordering is by blast radius, not by difficulty.** The Kad Rekod goes last and
alone. It is a mandatory record under MS ISO PS-8 (`docs/KAD-REKOD.md`), its row
heights are tuned in millimetres to land 22 rows on one sheet, its signatures are
permanent and can never be re-uploaded, and its failures are **invisible on
screen** — they surface on paper, at the officer who files the card. Nothing else
in the app has that property.

**The honest cost.** Roughly 8–11 working weeks of focused effort at this scope,
across six phases. That buys no new capability. It is paid for by every change
after it being cheaper and safer — which is a real return, but it is a bet on
future volume, so it is worth being sure the district expansion is actually
coming before spending it.

---

## Phase 0 — Seams and scaffolding *(no user-visible change)*

Nothing migrates until the safety net is portable.

1. **Extract the two network boundaries into modules** consumed by both V1 and
   V2: a Supabase adapter (wrapping `cloudLoad`, `cloudSave`, `cloudFormLoad`,
   `cloudFormSave`, `deleteRows`, signed-link resolution) and a Leaflet adapter
   (`initMap`, `renderMarkers`, `makeIcon`). Tests stub the adapter, not
   `window`.
2. **Freeze the DOM contract** the tests rely on — `#dashView`, `#dashZones`,
   `.fsheet`, `.fcard`, `.fpage`, `.ftab`, `.sigimg`, `.zrow` and the ids the
   suites query. Write it down in `docs/DOM-CONTRACT.md`. Vue must emit these
   exactly; they are not implementation detail any more.
3. **Stand up Vite** alongside the existing file — `vite.config.js`, Vue 3
   (Composition API, `<script setup>`), Pinia, Vitest for unit tests. Playwright
   suites stay as they are.
4. **Prove the CSP before writing a line of V2.** Vite's prod build must produce
   no inline script and no `eval`; `_headers` must still work at
   `script-src 'self'`. Extend `csp-and-vendor.js` to assert against `dist/`.
   *If this cannot be made to hold, stop and re-plan — the self-hosting decision
   in §3 outranks the framework choice.*
5. **`vendor/` → npm**, with versions pinned exactly (no `^`) and
   `vendor/README.md` rewritten to point at the lockfile.

**Gate:** all seven V1 suites green and unmodified, plus `tests/v2-csp.js` green.

### What Phase 0 actually found

Measured, not assumed. Several of these contradict what step 1–5 above expected.

- **The CSP holds, and can be tightened.** The Vite bundle runs under
  `script-src 'self'` with **`'unsafe-inline'` removed**. V1 needs
  `'unsafe-inline'` only because its JavaScript is inline in `index.html`, so
  cutover is an opportunity to harden the deployed policy, not a compromise.
  `_headers` is **not** changed yet — V1 still needs it.
- **The `_headers` comment was wrong.** It claims "script-src is `'self'` only";
  the deployed value is `script-src 'self' 'unsafe-inline'`. Left as-is because
  V1 depends on it; correct it at cutover, when it becomes true.
- **`modulePreload.polyfill` is not a CSP concern** on Vite 8 — verified with a
  real code split, the polyfill stays inside the bundle and no inline script is
  emitted. It is off for weight, not for security. The config comment claiming
  otherwise was corrected rather than left as plausible-sounding folklore.
- **Real Leaflet and real supabase-js from npm need no `eval`.** Bundled and
  scanned (415 KB), zero `eval` and zero dynamic `Function`. Phase 3 will not
  hit a CSP wall.
- **Step 1 was wrong as written.** It said to extract the network boundaries
  into modules "consumed by both V1 and V2". Doing that literally would make the
  live single-file app fetch ES modules — changing what officers run, adding
  requests to the critical path on a phone, and breaking the publish contract
  that copies exactly `index.html`, `_headers`, `vendor/`. All for no user
  benefit. **The seam already exists**: the suites stub `window.supabase` and
  `window.L`, and V2's adapters (`v2/src/lib/`) honour the same globals. V1 is
  untouched and the suites need no edit.
- **The eval assertion was weaker than advertised.** Vue's runtime template
  compiler calls `Function(...)` *without* `new` after minification, so a
  `/new Function/` check passed happily on a bundle the browser then refused to
  run. Found by aliasing Vue to the `esm-bundler` build and watching the suite;
  the browser-level "did it mount" assertion is the authority, and the static
  checks only name the failure.

---

## Phase 1 — Pinia stores *(no user-visible change)*

Model the state that already exists; do not invent new state.

| Store | Owns | Ported from |
|---|---|---|
| `hydrants` | the register, `cloudLoad` paging, `pullFresh`, the 60s poll | `loadHydrants`, `cloudLoad`, `pullFresh` |
| `filters` | `activeFilter`, `inspFilter`, `zoneFilter`, search | `visible()`, `renderBanner()` |
| `records` | form cache, `formFingerprint`, card growth | `loadForm`, `saveForm`, `rowIsComplete` |
| `pending` | the offline queue and flush | `loadPending`, `flushPending`, `flushAllPending` |
| `auth` | session, `IS_ADMIN`, role UI | `fetchRole`, `applyRoleUI` |

Two rules, both load-bearing:

- **`visible()` stays one derived getter.** Awam/Swasta × inspection status ×
  zone stack with AND (§3). Three separate filters that each mutate a list is how
  that invariant gets broken quietly.
- **`pending` is ported line by line, not re-designed.** §4.10 and §4.14 are both
  in this code. A failed flush must still change *nothing*.

**Gate — as written, this was wrong too.** It said the suites must pass "against
the Pinia implementation, still driving the V1 UI". They cannot: V1's UI does not
use Pinia, and it will not until Phases 2–5 move the views. Taken literally the
gate is either impossible or satisfied by a test that proves nothing.

**The gate that replaces it: differential parity.** Run V1's real logic and the
port over the same inputs and require identical decisions.

- `tests/v2-pending-parity.js` drives V1's **real `flushPending`** in a browser,
  triggered by an `online` event exactly as a reconnect does, beside the ported
  `planFlush()` — over all 32 combinations of (edit vs removal) × (cloud
  absent/unchanged/changed/signed) × (base unseen/never-existed/matching/
  differing), **twice**: once with the writes landing, once with them failing.
  Both halves are needed. "A failed flush changes nothing" (§4.14) is invisible
  on the success path, and the first version of this test had exactly that hole.
- `tests/v2-filters-parity.js` lifts V1's **real source text** for `visible`,
  `zoneSummary`, `counts` and `searchMatches` out of `index.html` and runs it
  against the port over five registers × 144 scope combinations.

Both were verified to go red on a deliberately broken port — the signed-row
guard removed, failed pushes dropped from the queue, and a search made to obey
the Awam/Swasta pills.

### Phase 1 status: partly done

Done and proved: **`pending`** (`v2/src/stores/pending.js` +
`pending-logic.js`) and **`filters`** (`filters-logic.js`).

Still to do: **`hydrants`** (paging, `pullFresh`, the 60s poll), **`records`**
(form cache, `formFingerprint`, card growth) and **`auth`**. `records` owns card
growth on a mandatory record and deserves its own sitting rather than the end of
a long one.

---

## Phase 2 — Dashboard

First view to move. It is the newest code, it is already scoped under
`#dashView`, and — critically — **it only reads**. A regression here misreports a
figure; it cannot damage a record.

- Components: `DashView`, `Donut`, `StatCards`, `ZonePanel`, `Jadual`.
- **The donut geometry is copied verbatim.** The projection constants and the
  derived-visibility rules in §2 are not to be "cleaned up" — guessing visibility
  produces phantom faces at particular data splits.
- `ZonePanel` keeps reading the whole register, ignoring the pills (§3), and
  stays **buttons, not a table**.
- Scoped styles replace the `#dashView` prefixing.

**Gate:** `zone-panel.js` green unchanged; dashboard figures reconcile in all
three scope states.

---

## Phase 3 — Map, registry, search

- Leaflet stays imperative behind the Phase 0 adapter. **Do not wrap markers in
  components** — 187 markers plus clustering through Vue's reactivity is slower
  and buys nothing.
- Preserve `cloudLoad(quiet)` / `noFitOnce`: a background pull must **never**
  re-fit the view (§3).
- Registry, pills, banner, place search, add-hydrant modal.

**Gate:** `hydrant-paging.js` green unchanged; `fitBounds` called 0 times during
a background pull, measured.

---

## Phase 4 — Auth shell and header

Login gate, account menu, role UI, the mobile hamburger, the z-index ladder
(header 1000 < modals 9999 < form 12000 < gate 100000 — §4.8). Small phase,
listed separately because it is the last thing standing between V2 and the record
card.

---

## Phase 5 — Kad Rekod *(alone, and last)*

Its own branch, its own release, nothing else in it.

- `docs/KAD-REKOD.md` is the specification; read it before starting.
- **Print CSS is global, never scoped.** Vue's `scoped` attribute selectors and
  the bundler's minifier both sit between the source and the paper. The mm row
  heights, the `page-break-before` rules, `flex-direction:column-reverse` on
  `.fsheet` and the `.sigimg` print filter move as one plain global stylesheet,
  in source order — that filter must still come **after** the screen `.sigimg`
  rule or it silently loses at equal specificity, exactly as the dead `6.6mm`
  rule did.
- The render loop stays **chronological** with the screen flip in CSS. Reversing
  the DOM reverses the paper and breaks the page breaks, invisibly.
- Signature permanence is unchanged in all three layers. **No SQL, no RLS, no
  trigger, no bucket change anywhere in V2** — the database is out of scope
  entirely.

**Gate:** `kad-rekod.js` and `signature-links.js` green unchanged, **plus a
rendered PDF page-counted by hand**, plus one card printed on the real printer
before release. The screen has never been sufficient evidence for this view.

---

## Branching and release

`publish-to-site.yml` publishes on **every push to `main`**. Holding V2 back
therefore means V2 must never touch `main` until cutover, so the phase branches
need an integration branch to land on:

```
claude/epb-v2-p0-seams  ─┐
claude/epb-v2-p1-stores ─┤
claude/epb-v2-p2-dash   ─┼──►  claude/epb-v2  ──►  main   (once, at cutover)
claude/epb-v2-p3-map    ─┤     (integration)        │
claude/epb-v2-p4-auth   ─┤                          └── publishes to officers
claude/epb-v2-p5-kad    ─┘
```

- One branch per phase, off `claude/epb-v2`, reviewed and merged on its own.
  Per-phase revert stays a single merge revert.
- `claude/epb-v2` runs the full suite on every push (`tests.yml` already fires on
  any push), so it is never allowed to sit red.
- **`main` stays V1 and keeps publishing V1** for the whole migration. An urgent
  V1 field fix goes to `main` as it does today, then gets merged *down* into
  `claude/epb-v2` — never the other way.
- **Cutover is one merge to `main`.** Rollback is one revert of that merge.

### The cost of holding it back, and what pays for it

Shipping each phase was what made this a strangler rather than a rewrite. Holding
V2 back means officers meet the entire rewrite on one day — and every serious bug
in §4 was found by real use, none by review. Two gates are therefore **mandatory
before cutover**, not optional polish:

1. **Staging deploy.** Publish the V2 bundle to a separate Cloudflare Pages
   preview pointing at the *same* Supabase project, so it is real data and real
   auth. Officers can be pointed at it for a week without `main` moving.
2. **Field test on real phones** — the offline round trip (aeroplane mode, edit,
   park, reconnect, confirm from a second device) and **one printed Kad Rekod**.
   This is the checklist that has caught every field bug so far.

If either gate is skipped, the plan has become a big-bang rewrite with a tidier
commit history, and the phasing bought nothing.

## Deploy and rollback

`publish-to-site.yml` changes from copying three paths to building and copying
`dist/`. Two things must survive the rewrite or the gate detaches:

- `needs: test` on the publish job, and `workflow_call` in `tests.yml` — one
  definition of how tests run (§3).
- The guard that refuses to publish if a CDN origin reappears or `sql/`/`tests/`
  would go public — rewritten to inspect the bundle rather than the source.

**Rollback is a one-commit revert in the site repo** back to the last V1
`index.html`, and a revert of the single cutover merge in this repo. Because V2
lands on `main` in one merge, that revert restores V1 whole — keep it that way by
never mixing an unrelated change into the cutover.

Verify every deploy by **content, not by the workflow's exit code** — compare
`git hash-object` between build and site repos, as now.

---

## Verification

- `npm test` — all seven suites, **unedited**, after every phase.
- Vitest unit tests for the Pinia stores (new, additive).
- Bundle audit: no external origin, no inline script, CSP `script-src 'self'`.
- 360 / 390 / 430px — no horizontal overflow.
- **Field check after each phase**, on a real phone: open offline, edit, park,
  reconnect, confirm from a second device. Every serious bug in §4 was found this
  way and none was found any other way.
- **Before Phase 5 ships: print a card.**

## Out of scope, explicitly

New features · redesign · PWA/service worker · district multi-tenancy · any
schema, RLS, trigger or bucket change · TypeScript (a second migration; do it
after V2 is stable, if at all).
