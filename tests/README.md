# Tests

V1 — what officers run today — is one static `index.html` with no build step,
so these are plain Node scripts that stand the real page up in Chromium, stub
out the two things that need network (Supabase and Leaflet), drive the actual
UI, and assert on what reaches the "server".

Because they drive real DOM in a real browser rather than calling functions,
they are **framework-agnostic**, and that is what makes them the contract for
the V2 migration (`docs/V2-ROADMAP.md`): a migrated view is done when these pass
**unedited**. A suite adjusted to fit the code it is testing has stopped being
evidence. The selectors they depend on are written down in
`docs/DOM-CONTRACT.md` and V2 must emit them exactly.

## Running

```sh
npm ci                       # once
npm test                     # all fifteen suites
npm run test:offline         # or one at a time
npm run test:clear
npm run test:kad
npm run test:zones
npm run test:paging
npm run test:csp
npm run test:signatures
npm run test:v2csp
npm run test:v2pending
npm run test:v2filters
npm run test:v2hydrants
npm run test:v2records
npm run test:v2donut
npm run test:v2dashdata
npm run test:v2dash
```

Chromium is found at `/opt/pw-browsers/chromium` by default; override with
`CHROMIUM_PATH=/path/to/chromium`.

Exit code is 0 when everything passes, 1 otherwise.

## CI

`.github/workflows/tests.yml` runs all fifteen suites on **every push and pull
request**, and `publish-to-site.yml` calls the same workflow and will not
publish until it passes:

```yaml
jobs:
  test:
    uses: ./.github/workflows/tests.yml
  publish:
    needs: test
```

**That gate is the point.** A red suite stops the change reaching officers.
A CI workflow that reports a failure while the broken build ships anyway is
decoration — if you ever change these workflows, keep `workflow_call` in
`tests.yml` and `needs: test` in the publish job, or the gate detaches without
anything appearing to break.

CI asks Playwright for its own Chromium path rather than hardcoding one, so
bumping the `playwright` version in `package.json` needs no change here.

## What is here

| File | Guards |
|---|---|
| `p0-offline-sync.js` | Inspection data typed with no signal must survive and reach the server. This was a real, reproduced data-loss bug (2026-08-03) — a failed save was silently overwritten by the cloud copy the next time the card was opened. Also covers the conflict path, signed rows, auto-push on reconnect, and that ordinary online saves are unchanged. |
| `clear-row.js` | An officer must be able to withdraw a wrong entry. Found in the field 2026-08-04: clearing a row and saving did nothing, because an upsert never deletes the rows it is not sent — and the app had no `.delete()` on `hydrant_records` at all. Covers the online clear, signed rows staying untouchable, clearing offline, a contested removal, the map pin's date badge following the rows that remain, and that a **failed flush changes nothing** (it used to drop the parked work). |
| `kad-rekod.js` | The Kad Rekod is a **mandatory** record under MS ISO — see `docs/KAD-REKOD.md`. Guards that a card is exactly 2 pages with its pages together and in order, that the screen shows the newest card first while **print stays oldest-first**, that card numbers are permanent and chronological, and that a new card appears only when the last row is complete **and saved** — offline included. Also guards that a **signature prints black**: they are photographed, so the stored ink is never black (darkest pixel measured at luminance 137, no pixel below 128) and it printed visibly faded while looking fine on screen. The print-only filter is asserted by measuring the rendered ink, not by matching the CSS. The print-facing assertions are the ones that matter most here: they are invisible on screen and would otherwise be found by whoever files the printed card. |
| `zone-panel.js` | "Nombor pili terkini" must stay true to the register. Zones are derived from the label's leading letter and never stored, so the panel cannot drift — the user's hand-written version was already a row ahead of the seed data before it was written down. Covers the derived ranges and counts, that the panel ignores the Awam/Swasta pills while the zone *filter* stacks with them, a new zone letter appearing on its own, and the two ways the panel could quietly lie: a gap inside a range, and a label that does not parse. Both must be reported. |
| `hydrant-paging.js` | PostgREST truncates a response at 1000 rows and reports no error, so an unbounded read would drop hydrants off the map with nothing on screen to say so. Stubs 2400 hydrants — and truncates like the real API, or the test could not show the bug — then asserts every one arrives, the page boundaries are right, and a failed read leaves the local copy alone. |
| `csp-and-vendor.js` | The libraries stay self-hosted and the app still works under the tightened CSP. Serves the real files with the CSP parsed out of `_headers` and boots the app with the genuine Leaflet. Fails if a CDN tag is ever added back. |
| `signature-links.js` | Signature images resolve to short-lived signed links, and — critically — fall back to the stored value when signing is unavailable, so a signature never fails to display. Covers rows stored as legacy public URLs and as paths. |
| `v2-csp.js` | **The V2 migration's stop-condition** (`docs/V2-ROADMAP.md`) — the only suite here that tests V2 rather than V1. The strongest security decision in this project is that no third-party script runs in the app: everything self-hosted, `script-src 'self'`. A build step is the classic way that quietly ends — bundlers inject inline bootstrap scripts and template compilers need `eval`. So this builds the Vite bundle and serves it under the real CSP from `_headers` **with `'unsafe-inline'` stripped from `script-src`**, then requires a working Vue + Pinia app and zero violations. V1 needs `'unsafe-inline'` because its JavaScript is inline; V2 does not, so the deployed policy can be **tightened** at cutover. Also pins V2's npm libraries to the exact versions vendored for V1 — if those drift, a V2 defect could be the rewrite or could be a library bump, and no amount of reading the diff separates those two. |
| `v2-pending-parity.js` | **The V2 offline queue must decide exactly what V1 decides.** This logic has lost, or nearly lost, real field data three times (§4.10, §4.13, §4.14), and it is a five-way decision over what the cloud held when the officer went offline — one inverted branch loses a record with no error anywhere. So this does not check the port against a careful reading: it runs V1's **real `flushPending`** in a browser, triggered by an `online` event exactly as a reconnect does, alongside the ported `planFlush()`, over all 32 combinations of (edit vs removal) × (cloud absent/unchanged/changed/signed) × (base unseen/never-existed/matching/differing) — **twice**, once with the writes landing and once with them failing, because "a failed flush changes nothing" is only visible on the failure path. Verified to go red on a port with the signed-row guard removed, and on one that drops failed pushes from the queue. |
| `v2-filters-parity.js` | Scope, search and the zone panel, same principle without a browser: it lifts V1's **real source text** for `visible`, `zoneSummary`, `counts` and `searchMatches` out of `index.html` and runs it against the port over five registers × 144 scope combinations. Guards that the three axes still stack with AND, that a search still ignores the pills and searches the whole register, and that a gap in a range and an unparseable label are still both reported. Verified to go red on a port where a search obeys the Awam/Swasta pills. |
| `v2-hydrants-parity.js` | Reading the register. Lifts V1's **real `cloudLoad`** out of `index.html` and runs it in a sandbox against the port over 0/1/187/999/1000/1001/2400 rows, comparing the exact page ranges requested and the resulting register. Guards §4.1 (PostgREST truncates at 1000 and reports no error), that a failed **or empty** read leaves the local copy alone — a partial read looks exactly like a mass deletion — and that a quiet background pull arms `noFitOnce` rather than clearing the fit key, so the map never jumps away from what an officer is reading. |
| `v2-records-parity.js` | **The Kad Rekod's shape and growth rules** — the highest-consequence port in the migration, on a controlled record under MS ISO PS-8 (`docs/KAD-REKOD.md`). Compares the ported column keys, column types and per-card capacities against V1's real `SECTIONS` field by field, then compares `rowIsComplete`, `cardCount`, `padToCards`, `normalizeForm`, `formFingerprint` and the new-card rule against V1's real source. This caught two whole column lists transcribed wrongly on the first run: a mistyped column key produces a card that looks right and silently drops that column's data on every save. Fixtures are built from each section's own columns, because a first version hardcoded `tarikh`/`penguji` and was therefore testing Kompaun — the one section with an unusual shape — with empty rows. |
| `v2-donut-parity.js` | The 3D donut's geometry. Compares the **whole emitted SVG string, character for character**, against V1's `buildDonut` — 10 named data splits, 26 animation frames each, plus 231 arbitrary splits. Exact equality is the point: CLAUDE.md §2 is explicit that face visibility is derived and must not be guessed, because guessing produces phantom faces at particular data splits, and "close enough" has no meaning for geometry. Includes three deliberately tiny last-slice cases, added after a mutation to the inner-wall band passed everything else — the band only bites when a slice is small enough that the gap shrinks below a degree. |
| `v2-dashboard-parity.js` | The dashboard's data layer: rolling 6-month periods, the paged Pengujian scan (§4.1 — Supabase truncates at 1000 rows and reports no error, and the missing rows would simply read as "Belum diperiksa"), `mergeIndex`, and the scope rule that a cleared pill means **Semua**, not Awam (§4.3). Also checks that a first-page failure falls back to local data while a *later* failure keeps what already arrived. |
| `v2-dashboard-view.js` | The V2 dashboard components mounted for real in Chromium and driven through the DOM, asserting the selectors frozen in `docs/DOM-CONTRACT.md`. Mirrors what `zone-panel.js` claims about V1 — same scenarios, same meanings — so the two views can be compared claim for claim. It does **not** edit `zone-panel.js`: that suite is V1's and must keep passing unchanged. Builds the harness page, which is excluded from production builds and asserted absent by `v2-csp.js`. |

## Adding to this

A test earns its place by **failing on the broken code**. Before committing
one, check out the version without your fix and confirm the test goes red —
otherwise it guards nothing.
