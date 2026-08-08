# e-Pili Bomba V2 — Vue 3 + Vite + Pinia

> **Status: Phases 0, 1, 2 and most of 3 built. Phases 4 and 5 not started.**
>
> V1 (`index.html`) is what runs at epilibomba.com and is **byte-identical** to
> what it was before this work began. Nothing here has reached an officer, and
> nothing can until a deliberate merge to `main`.
>
> Phases 0, 1 and 2 are **merged into `claude/epb-v2`**, each as its own merge
> commit so any one phase can still be reverted on its own — a clean merge proves
> nothing about behaviour, so the full suite is run after each one rather than
> assumed. Phase 3 is on `claude/epb-v2-p3-map` and not yet merged.
>
> **`main` stays V1 until cutover**, which is a single deliberate merge.

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
| Charting | **Keep the hand-built 3D donut.** Chart.js reconsidered for V2.1 |

### Charting — Chart.js considered and declined for V2 (2026-08-07)

Raised on the reasonable instinct that a charting library is the right idiom now
the app is on Vue. Declined **for this chart**, on one decisive fact and three
supporting ones.

**Chart.js cannot draw this chart.** There is no 3D doughnut in Chart.js v4 and
no maintained plugin that adds one. The chart is an oblique projection with real
extruded geometry, and `CLAUDE.md` §3 records the form as locked: *"Flat-shaded
3D donut, upright, depth right, 50% depth — matches supplied reference."*
Substituting a flat 2D doughnut is a **redesign**, which is the one thing this
migration excludes. That makes it a product decision for the officers, not a
side effect of choosing a library.

Supporting, in case the question returns:

| | Now | With Chart.js |
|---|---|---|
| Size | `v2/src/lib/donut.js`, **8.4 KB**, no dependencies | ~70 KB gzip + `vue-chartjs` |
| Churn | Frozen — it never needs to change again | Tracks a third-party release cycle |
| Proof | 29 assertions, character-for-character identity with V1 | Nothing comparable is possible |
| Screen reader | `role="img"`, per-segment `aria-label`, `tabindex` | Canvas is opaque without extra work |

Worth being clear about one thing the objection got right and one it got wrong.
Right: hand-written chart code *is* normally a liability. Wrong: `donut.js` is
not un-Vue — it is a plain ES module imported by a component, which is exactly
how a Vue app consumes a rendering function.

**Where Chart.js does earn its place: new charts in V2.1.** Inspection trends
over time, per-zone bars, monthly throughput. There is no existing design to
preserve and no parity to lose, and hand-writing a second and third generator
would be daft. Revisit after cutover.

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

### Phase 1 status: all five stores done

| Store | Pure logic | Parity suite |
|---|---|---|
| `pending` | `pending-logic.js` | `v2-pending-parity.js` — 64 |
| `filters` | `filters-logic.js` | `v2-filters-parity.js` — 720 comparisons |
| `hydrants` | `hydrants-logic.js` | `v2-hydrants-parity.js` — 22 |
| `records` | `records-logic.js` | `v2-records-parity.js` — 163 |
| `auth` | — | none, deliberately (see below) |

`auth` has no parity suite on purpose. Unlike the other four it holds no
decision worth getting wrong — everything V1's `applyRoleUI` does is DOM
toggling, which becomes template bindings in Phases 2–4 and is covered there.
A suite asserting `role === 'admin'` would be ceremony, and ceremony makes the
suites that matter harder to take seriously. The rule that IS load-bearing is
written at the top of the store: **the client's idea of the role is a UI
convenience.** Every write is authorised by RLS in the database, evaluated as
the calling role. Hiding a button is courtesy, not the control.

### What Phase 1 found

- **Two whole column lists were transcribed wrongly**, and the config comparison
  caught them on its first run. `pengujian` records pressure readings
  (`penguji`, `statik`, `semasa`, `gpm`, `catatan`) — not the `injap`/`tekanan`
  guessed — and `kompaun` is two six-column blocks (`t1…b1`, `t2…b2`) with **no
  signature column at all**. A mistyped column key produces a card that looks
  perfectly right and silently drops that column's data on every save. Nothing
  short of comparing against V1's real `SECTIONS` would have found it.
- **A first version of the records fixtures tested Kompaun with empty rows**,
  because it hardcoded `tarikh`/`penguji` as key names — on the one section
  whose shape is unusual. Fixtures are now derived from each section's own
  columns.
- **`needsNewCard` nearly diverged.** V1 tests the last row of the *array*;
  the first port tested row `cards*perPage - 1`. Identical while the form is
  padded to whole cards, different on a ragged one. Matched to V1 and the
  transcription is guarded — if `maybeAddPage`'s condition is ever edited, the
  suite throws rather than comparing against a stale copy.
- **`v2/` needed its own `package.json`** declaring `"type": "module"`. The root
  must stay CommonJS or every suite in `tests/` breaks; without the scoped
  file, node re-parsed each V2 source it imported and said so on stderr.

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

**Gate:** `zone-panel.js` green **unchanged** (it tests V1 and must keep
passing), plus three new suites that test V2:

- `v2-donut-parity.js` — the **whole emitted SVG string**, character for
  character, against V1's `buildDonut`. 10 named data splits × 26 animation
  frames, plus 231 arbitrary splits.
- `v2-dashboard-parity.js` — period arithmetic, the paged scan (§4.1),
  `mergeIndex`, and the scope rule that a cleared pill means Semua not Awam
  (§4.3).
- `v2-dashboard-view.js` — the real components mounted in Chromium, driven
  through the DOM, asserting the frozen selectors from `docs/DOM-CONTRACT.md`
  and mirroring what `zone-panel.js` claims about V1.

### Phase 2 status: complete

`Donut`, `StatCards`, `ZonePanel`, `DashView`, `Jadual`, the whole data layer,
and the stylesheet.

- **CSS ported verbatim** into `v2/src/styles/dashboard.css` (V1's `#dashView`
  block) plus `tokens.css` for the custom properties it references. Kept as a
  plain global stylesheet with the `#dashView` prefix intact — Vue `scoped`
  rewrites selectors, and those class names are an interface
  (`docs/DOM-CONTRACT.md`). Guarded by `tests/v2-dashboard-css.js`, which
  compares **computed styles against V1 in the same browser** rather than
  diffing CSS text.
- **Jadual built** with every decision from §3 carried over: admin-only writes,
  latest Tarikh first with its two tie-breaks, one folder per period, 100 rows
  plus "Lihat semua", edit reusing the add form, `confirm()` before delete, no
  "done" tick and **no date filter**.


### What finishing Phase 2 found

- **The components had been emitting invented class names.** `DashView` used
  `.dashhead` / `.dashgrid` / `.zonebox` and `StatCards` used `.dstat-n` — none
  of which exist in V1 — so the verbatim stylesheet targeted nothing at all.
  They now emit V1's structure exactly. This is the strongest argument for the
  computed-style gate: everything looked fine and every earlier assertion still
  passed, because the earlier test asserted the invented names too.
- **`cssCodeSplit: false` means both entries share ONE stylesheet.** Removing
  `tokens.css` from the harness alone changed nothing, because it still arrived
  via `main.js`. It had to go from both before the test went red. Worth knowing
  before anyone trusts an entry-scoped CSS assertion.
- **The donut click stays dispatched, but for a different reason than before.**
  The old comment blamed the missing CSS; that is fixed and now asserted
  directly. The real reason is geometry — a donut arc's bounding-box centre lies
  outside the arc, so a real click lands on a neighbouring path, and no styling
  changes that.

### What Phase 2 found

- **A test can be blind at exactly the boundary it exists to guard.** A mutation
  to the donut's inner-wall band (`90..270` → `90..269`) passed every case in
  the first version of the parity suite. The band only bites when a segment ends
  near 270°, which needs the *last* category small enough that `gapFor` shrinks
  the gap below ~1° — a fraction under about 1/63. The arbitrary sweep used
  `total: 20`, where the smallest slice is 5% and the gap never shrinks at all.
  Three "tiny last slice" cases were added; the mutation now fails 9 assertions.
- **One mutation is genuinely equivalent.** Start-cap visibility `dsin(d0) > 0`
  → `>= 0` changes nothing, because `d0` can never land exactly on the axis: a
  zero gap requires a zero fraction, and those segments are already filtered
  out. Recorded so nobody later "fixes" the test to catch it.
- **The harness must never ship.** `v2/harness.html` mounts components with
  injected fixtures and is built only under `V2_HARNESS=1`, because
  `publish-to-site.yml` copies `dist/` wholesale. `v2-csp.js` now asserts a
  production build contains neither the page nor its bundle.
- **A hardcoded expectation was wrong where a derived one would not have been.**
  The view test asserted 170 Awam from CLAUDE.md's 187-hydrant seed, while its
  own fixture follows the zone sketch and totals 188. Totals are now derived
  from the fixture — the same lesson that made zones derived rather than
  stored (§3).

---

## A constraint on Phases 3–5: don't foreclose district

District expansion is **not scheduled** and is explicitly out of scope below.
`docs/PRD.md` §7 holds the analysis: it is a `district` column with scoped
writes, not a folder, and it costs about two days once a second district is
actually confirmed.

But Phases 3–5 are being written now, and the cheapest moment to avoid a
retrofit is while the code is being written anyway. So, at zero cost:

- **Keep queries going through store methods that take their filters as
  arguments.** Adding `.eq('district', …)` later should be one line in one
  place, not a hunt through components.
- **Keep `visible()` as one derived getter.** `filters-logic.js` already stacks
  Awam/Swasta × inspection status × zone with AND; district would be a fourth
  axis of the same shape rather than a special case.
- **Do not add a district parameter, column, selector or default anywhere.**
  The point is to avoid foreclosing it, not to build it. Building multi-district
  support for a district that never arrives is pure cost, and half-built
  multi-tenancy is worse than none — it looks like a guarantee and is not one.

## Phase 3 — Map, registry, search

- Leaflet stays imperative behind the Phase 0 adapter. **Do not wrap markers in
  components** — 187 markers plus clustering through Vue's reactivity is slower
  and buys nothing.
- Preserve `cloudLoad(quiet)` / `noFitOnce`: a background pull must **never**
  re-fit the view (§3).
- Registry, pills, banner, place search, add-hydrant modal.

**Gate:** `hydrant-paging.js` green unchanged; `fitBounds` called 0 times during
a background pull, measured.

### Phase 3 status: logic done, components to come

Done: **`v2/src/stores/map-logic.js`** and **`tests/v2-map-parity.js`** (41
assertions) — the palette, the date badge, marker HTML and icon geometry, the
tooltip, and **the fit rule**.

The fit rule was taken first deliberately. It is the only part of the map layer
with real consequence, and it is a rule about something *not* happening:

> A background pull must **never** re-fit the map.

That failure produces no error. The map simply jumps away from whatever an
officer is reading, mid-read, on a phone — which is why it needs a test rather
than care. Two details are easy to lose in a port and both are guarded:
`noFitOnce` is **consumed** (it records the key without fitting, so the *next*
genuine change still fits), and an empty result **never** fits and never records
its key.

Two things about the suite worth keeping:

- V1 has no function for the fit rule — it is three lines inline in
  `renderMarkers`. The transcription is **guarded**: if that code is edited, the
  test throws rather than silently comparing the port against a stale copy.
- The rule is asserted **directly** as well as by parity. Parity alone would
  happily agree with V1 if V1 itself ever regressed.

Verified red on three mutations: a background pull that re-fits (3 failures), an
empty result that fits, and an order-insensitive key made order-sensitive.

**Components done too:** `MapView`, `Pills`, `Registry`, `Banner`, `MapShell`,
plus `v2/src/styles/map.css` copied verbatim, guarded by `tests/v2-map-view.js`
(27 assertions). **The gate is met: `fitBounds` is called 0 times during a
background pull**, counted in a real browser, and the suite goes red on a
`MapView` that ignores `noFitOnce`.

### What Phase 3 found — the adapter defeated its own seam

`v2/src/lib/leaflet.js` imported Leaflet **statically**. Leaflet assigns itself
to `window.L` when it loads, so the import overwrote the tests' stub before the
component ever asked for it: the map mounted with the real library against a
fake DOM, and every assertion read zero.

That is worse than an ordinary bug, because the seam is what makes the suites
framework-agnostic and therefore usable as the migration contract. It had been
sitting there since Phase 0, unnoticed, because nothing had used it yet.

V1 dodges the same problem only by accident — its suites copy `index.html` to a
temp dir without `vendor/`, so the `<script src="vendor/leaflet.js">` 404s and
the stub survives. V2 bundles its dependencies, so the check has to be explicit.
The import is now lazy and only loads when nothing has provided an `L`, which
also moved 148 KB of Leaflet out of the main chunk: the harness bundle went from
176 KB to 29.5 KB.

### Place search and the add-hydrant modal — done

`SearchBox.vue` and `AddHydrantModal.vue`, with `searchInfo()` in
`filters-logic.js` and the add rules (`validAdd`, `newHydrant`, the geolocation
messages) in `map-logic.js`. Guarded by **`tests/v2-map-search-add.js`, 56
assertions.**

Two behaviours carry the piece, and neither announces itself when it breaks.

**A search ignores the Awam/Swasta pills.** `visible()` already returns the
search matches before it looks at any axis, so this is a property of the port
rather than of the components — but the *consequence* is the components': the
result line has to say the pill was ignored, or the box reports "1 pili
dijumpai" while a pill claims to be narrowing the view and the two silently
disagree. If a search ever did respect the pill, a pili sitting in the register
would report as **Tiada pili dijumpai**, which reads as a lost hydrant, not as
a filter.

**A search re-fits the map.** V1 clears `fittedKey` inside `applySearch`.
`MapShell` bumps a `refit` counter that `MapView` watches, in the **same**
watcher as `visible` — two watchers fit twice, once wastefully, on a phone.

The second is the one worth recording, because **the first version of that
assertion was blind.** Deleting the `fittedKey` reset left every search test
green: a narrowing search changes the visible set, so the key differs and the
map fits anyway. The reset only matters for a search whose matches are the set
already fitted — the officer has panned and zoomed by hand, and V1 re-centres
regardless. That case is now asserted, and it is the only mutation of the four
that the suite could not originally see.

Verified red on four mutations: a search that respects the pill (2 failures), a
missing `fittedKey` reset, a blank label accepted by the add form, and a dropped
`box-sizing:border-box` — which is how the phone widths were found overflowing
sideways (§4.9). V1's reset block was missing from `tokens.css` entirely; it is
now carried verbatim, and the overflow assertions at 360/390/430px are what
caught it.

The add modal is asserted on its **validation**, not its looks: a hydrant with
a bad coordinate is a pin in the sea, and the officer who typed it is standing
next to the real one with no way to tell. Save stays disabled and reads
"Fill Lat/Long" until the label and both coordinates are valid, a map tap fills
the fields live while the modal is open and is ignored when it is not, and
"Guna Lokasi Saya" keeps V1's Bahasa Malaysia messages — including the
low-accuracy warning at 30 m, which tells the officer to re-take the fix rather
than accepting it quietly. The button depends on `geolocation=(self)` in
`_headers`; nothing in the component can compensate for that header's absence.

**Phase 3 is complete.**

---

## Phase 4 — Auth shell and header

Login gate, account menu, role UI, the mobile hamburger, the z-index ladder
(header 1000 < modals 9999 < form 12000 < gate 100000 — §4.8). Small phase,
listed separately because it is the last thing standing between V2 and the record
card.

### What Phase 4 found first: THERE WAS NO APP

`v2/src/App.vue` was a **CSP probe** — a count and two buttons, written in
Phase 0 so `v2-csp.js` had something to boot under the hardened policy. It was
never replaced. For three phases the production bundle contained **no
application at all**, while every component suite ran green, because every one
of them mounts components through the test harness rather than through the app.

Found by checking the production entry point before recommending a staging
deploy off it. The check took one command; the belief it corrected had been
stated confidently twice.

**The lesson is the important part: a green suite says the parts work, never
that the whole exists.** The harness is a good tool and it has caught real
defects, but a component proven in isolation is not a shipped component. There
is now one assertion that cannot pass without an assembled app — `v2-csp.js`
mounts `.app` and requires the login gate — and it replaced the probe assertion
that could have passed forever.

### Built

`App.vue` (the real one), `AppHeader.vue`, `AuthGate.vue`, and
`v2/src/styles/shell.css` copied verbatim. Guarded by **`tests/v2-shell.js`,
50 assertions**.

The shell owns three things, and each is above the components on purpose:

- **The scope filters.** Awam/Swasta is read by the map *and* the dashboard, so
  it lives above both. §4.2 was the opposite arrangement.
- **The session.** Nothing renders below the gate until a role resolves — not
  as a security control (RLS decides that, in the database, as the calling
  role) but because an app rendered before its session exists reads the
  register as empty and looks like 187 deleted hydrants.
- **The refresh cadence.** Foreground, focus, online, plus a 60s poll while
  visible, throttled to one pull per 10s, nothing at all while hidden. Every
  one is a *quiet* pull and must never re-fit the map.

### Two defects the suite caught immediately

- **The app rendered TWO sets of pills.** `MapShell` still carried the stand-in
  set added in Phase 3 "for the harness, until the real header arrives" — and
  when the real header arrived, nothing removed it. The harness now mounts
  `Pills` beside `MapShell` instead, so production code carries no branch that
  exists only for tests.
- **A sign-out assertion that read as a failure and was not one.** `signOut`
  reloads the page by design, so anything recorded on `window` dies with it.
  Chromium will not let `window.location.reload` be redefined either. Recorded
  in `sessionStorage` and observed through Playwright's navigation event
  instead.

### And one wrong claim of my own, corrected rather than defended

The suite's comment asserted that a menu item cannot delegate to a
`display:none` button because "a click on a hidden element is not dispatched".
The mutation test disagreed: `element.click()` *does* fire on a hidden element
— only *user* gestures require visibility. The rationale was wrong, so the
rationale was fixed. The assertion stays, on its real merit: below 640px the
hamburger is the **only** route to Tambah Pili and sign-out, so it is asserted
end to end at 390px through a real user click.

Verified red on: an unknown role failing open to admin, and a gate that never
shows.

### A third defect, and the one that hid best

Copying V1's mobile block into `map.css`, I sliced through `.cards .card` and
left the file **one `}` short**. An unbalanced stylesheet does not fail and does
not warn — the parser nests everything after the unclosed block inside it, so
those rules stop applying. `main.js` imports `dashboard.css` after `map.css`, so
**the whole dashboard silently lost its styling** while the build stayed green,
the app rendered, and 16 suites passed. It surfaced only in
`v2-dashboard-css.js`, which compares computed values against V1 — 25 red at
once.

`tests/v2-dashboard-css.js` now checks brace balance on the **built** file,
which is both what the browser parses and the point where one stylesheet's
missing brace becomes another's problem. Counting braces in the sources is not
equivalent: `{` and `}` appear inside comments and `@keyframes` prose.

The transcription rule that follows from it: **copy whole rules, never line
ranges.**

### Staging deploy — how it actually ships (2026-08-08)

Built by **Cloudflare Pages directly from `claude/epb-v2`**, not by a workflow.
`.github/workflows/deploy-staging.yml` was written and then deleted: with Git
integration Cloudflare does the building and deploying, and a second definition
of that would be exactly the duplication §3 warns about.

**Two trades were made knowingly and are recorded in `docs/STAGING.md`:**

- **The suites do not gate the deploy.** Cloudflare ships every push, green or
  red. The alternative — CI fast-forwarding a green-only branch for Cloudflare
  to watch — was offered and declined in favour of simplicity. `tests.yml`
  still runs on every push, so red is visible; it is just visible after the
  deploy.
- **Staging writes to the production Supabase project.** That is what makes it
  worth testing on, and it means every save on staging is a real save against
  the real register.

What *is* gated is the **artefact**. `scripts/verify-bundle.js` is the last
step of the build command, and a non-zero exit fails the deployment so the
previous version stays up. Ten checks: `index.html` and `_headers` present,
`script-src 'self'` with no `unsafe-inline`, `noindex`, `geolocation=(self)`,
no `harness.html` or `harness-*` bundle, no `sql/`, no `tests/`, no CDN origin
anywhere in the built JS/CSS/HTML. Verified by mutation before being trusted —
a `V2_HARNESS=1` build, a removed `_headers` and a planted CDN string each
produce exit code 1, checked as a real exit code rather than through a pipe,
because the exit code *is* the mechanism.

So: **a malformed bundle cannot reach staging; a logic regression can.**

### The staging CSP

`_headers` for the V2 bundle lives at `v2/public/_headers`; Vite copies it into
`dist/`. (How the bundle is deployed is described once, above — there is no
second account of it here. A duplicate description is what let this section go
on claiming a deleted workflow and a test gate the chosen route does not have.)

The staging policy is **stricter than production**: `script-src 'self'` with no
`'unsafe-inline'`. V1 needs that allowance because the whole app is an inline
`<script>`; V2 is a bundle and does not. `v2-csp.js` now boots the real app
under the **actual** staging header rather than one it synthesised itself, and
asserts the two policies differ in `script-src` *alone* — a staging header that
quietly widened `img-src` or `connect-src` would make its green meaningless at
cutover. `X-Robots-Tag: noindex` is staging-only and comes off at cutover.

**Two things staging cannot yet do, and both should be said to officers up
front:** the Kad Rekod opens and can be edited and saved, but it **cannot be
signed** — signature capture and signed-link resolution are still to port, so
existing signatures may not display either; and the dashboard reports every
hydrant as *Belum diperiksa*, because the Pengujian scan belongs to Phase 5
too. Honest zeros were chosen over guessed figures — a wrong number on a
dashboard is worse than an obvious gap.

`docs/STAGING.md` §4 carries this same list and is the copy to keep current;
it is what someone reads before pointing an officer at the URL.

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

### Phase 5 status — the card renders and is page-counted; the data paths are not ported

**Done:** `v2/src/styles/kad-rekod.css` (index.html 396–655, copied whole),
`KadRekod.vue`, `v2/src/lib/signature-print.js`, and the card wired into
`App.vue` for the **local** round trip — open from a pin, edit, save to
localStorage, and grow a new card when the last row of a section is complete.
Growth fires on the local save, not on a successful upload, so an officer with
no signal still gets their next card.

Guarded by **`tests/v2-kad-rekod.js`, 39 assertions** — the only suite in this
repo that **renders to PDF and counts the pages**.

#### The defect that assertion existed for, found on its first run

`#formOverlay` must be a **direct child of `<body>`**. V1's print rule is
`body.form-open > *:not(#formOverlay){display:none!important}`, and in V2 the
component naturally renders inside `#app` — so `#app` matched the rule and
**the entire card was `display:none` on paper.** It printed one blank sheet.

Nothing on screen changed. Nothing in the PDF looked wrong; the card simply was
not in it. The only signal was the page count: 1 where 2 was required.

Fixed with `<Teleport to="body">` — matching V1's DOM position rather than
editing the print CSS to suit a new structure. **The CSS is the part that has
been proven on paper; the component is not.** Whenever those two disagree, the
component moves.

#### What the PDF gate is actually sensitive to

Worth writing down rather than assuming. Raising `.ftab.pengujian td` from
8.3mm: 9.6mm and 11mm still produce 2 pages; **13mm produces 3** and the suite
goes red on all three fixtures. So there is real headroom on Letter at an 8mm
margin — the layout is not on a knife edge — but the gate does catch the
failure mode it exists for. The millimetre difference between Pengujian rows
and the rest is asserted separately, border-independently, because that is the
part that would quietly vanish if someone normalised the heights to one value.

Also verified red on: an overlay that is not a direct child of body (3
failures), and a screen order that stops being newest-first (2).

#### The cloud round trip — ported, with its own suite

`v2/src/stores/record-sync.js`, guarded by **`tests/v2-record-sync.js`, 38
assertions.** This is the V2 counterpart of `p0-offline-sync.js` and
`clear-row.js`, which test V1's `index.html` and were watching nothing in V2.

The suites were written from V1's scenarios **before** the port was trusted,
and the four defect classes were each verified red by removing their guard:

| Mutation | Failures |
|---|---|
| A failed flush drops the parked work (§4.14) | 4 |
| Clearing never issues a DELETE (§4.13) | 3 |
| Save does not park before the request (§4.10) | 9 |
| Signed permanence relies on the in-memory flag alone | 1 |

**One real defect, and it is V2-only.** `deadRows` refused to delete a row
carrying `_signed` — which was sufficient in V1, because V1 always wrote *into*
the existing row object so the flag survived. V2 can **replace** a row with a
fresh blank one, and a blank row carries no `_signed`. An admin clearing a
signed row therefore produced a DELETE for it, and the row went. The database
trigger would have refused it — but a client that has to be caught by the
trigger is a client that will eventually find a path around it. Signedness is
now also snapshotted from the server at open, where no UI action can lose it.

**And one assertion that passed for the wrong reason**, which is worth more
than the defect. The follow-up case — permanence surviving a *preceding* save —
went green on the first run. Not because the guard worked: `save()`
re-snapshots the base from the rows it just wrote, a signed row is never in
that payload, so the row's *base* was forgotten too and `deadRows` skipped it
as "cloud never held this". Right outcome, accidental reason. Remove the base
coincidence and a signed row becomes deletable again. The signed map is now
merged rather than replaced — additive only, since signedness can never be
withdrawn.

#### Signatures — ported, and Phase 5 is complete

`v2/src/lib/signature-links.js` (short-lived signed links) and
`signature-capture.js` (photo → transparent, trimmed PNG), plus `signRow()` in
`record-sync.js` and `SignPopup.vue`. Guarded by **`tests/v2-signatures.js`,
43 assertions.**

Two rules carry it, and both come straight from `docs/KAD-REKOD.md` §5 —
*the signature IS the evidence*:

**A signed row is permanent.** Signing is the only irreversible action in the
app. The upload happens **first** and the row is marked signed only if it
succeeded — the other order produces a row claiming to be signed and pointing
at an image that does not exist, a record asserting evidence it cannot produce.
A second signature is refused. `upsert:false` on the upload makes a path
collision an error rather than a silent overwrite. And signing registers
permanence in `cloudSigned`, where no UI action can lose it, so clearing a
signed row still produces no DELETE.

**A signature is never silently unreachable.** The bucket is private, so links
are short-lived and resolved per viewing, cached for their lifetime so
reopening a card costs no round trip. Every failure path — request errors,
request rejects, no backend at all — falls back to the stored value rather than
showing nothing, because **a blank T.T on a signed row reads as the signature
having been lost.** Rows signed before the bucket was locked down hold a full
public URL rather than a path; `sigPath()` extracts it, and it must keep
working forever since those rows can never be corrected.

Verified red on five mutations: a signed row that can be re-signed (2), a row
marked signed despite a failed upload (2), a public URL stored instead of the
path (1), no fallback when signing fails (2), and accepting only one spelling
of Supabase's signed-url key (1) — that last one would resolve nothing and look
exactly like a lost signature.

**Phase 5 is complete.** The remaining gate is not code: `docs/KAD-REKOD.md` §6
requires **one card printed on the real printer** before this ships.

#### And the gate that no suite can give

`docs/KAD-REKOD.md` §6 requires **a real printout before anything touching this
card ships**, and this suite does not replace it. Three print defects have
shipped on this card; every one was measurable, and every one still reached
paper wrong. The page count is necessary evidence. It has never been
sufficient.

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
