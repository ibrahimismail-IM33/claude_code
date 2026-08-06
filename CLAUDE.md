# e-Pili Bomba Kunak

Project context for Claude Code sessions: what this is, what was decided and
why, what was built, and what is still open. Read §3 (decisions) and §10
(conventions) before changing anything — several choices here look arbitrary
but are load-bearing, and §5 lists mistakes already made once.

Last updated: 2026-08-02 · branch `claude/epilibomba-build-compile-3hhuqp`

**Before you start**
- This is a **live government app** at epilibomba.com used by BBP Kunak
  officers. Prefer a small verified change over a large plausible one.
- The app's CSS is **global** — `.card`, `.btn`, `.pill`, `.mono` are taken.
  Scope anything new (the dashboard lives under `#dashView`).
- **Verify in a browser before saying it works.** Playwright with Chromium at
  `/opt/pw-browsers/chromium` is available; several bugs in §4 were invisible
  in a screenshot and only showed up when measured.
- Ask before changing anything in §7 (open questions) — those are the user's
  calls, not yours.

---

## 1. What this is

Fire-hydrant (pili bomba) map and inspection-record app for **BBP Kunak, Sabah**
(JBPM). Officers use it on a phone, in the field, sometimes in gloves, to locate
hydrants, record inspections, and maintain the **Kad Rekod Pili Bomba**.

Live at **epilibomba.com**. UI language is Bahasa Malaysia.

### Stack
- **Frontend** — one static `index.html`, vanilla JS, no build step. Leaflet
  1.9.4 + markercluster, OpenStreetMap tiles. Fonts: Bricolage Grotesque /
  DM Sans / JetBrains Mono. CDN with unpkg → jsdelivr fallback.
- **Backend** — Supabase (Postgres + Auth + Storage), project
  `isxfhocfkjamjchmicwq`.
- **Hosting** — Cloudflare Pages (static + `_headers`).

### Files
| Path | What |
|---|---|
| `index.html` | The entire app |
| `vendor/` | Leaflet, markercluster and the Supabase client, **served from this site, not a CDN**. See `vendor/README.md` for versions and how to update |
| `tests/` | Node + Playwright regression tests. See `tests/README.md` |
| `_headers` | CSP / HSTS / Permissions-Policy. `geolocation=(self)` is required by "Guna Lokasi Saya" |
| `sql/supabase-setup.sql` | **1st** — profiles, `is_admin()`, hydrants (187 seeded) |
| `sql/supabase-records-setup.sql` | **2nd** — hydrant_records, signatures bucket, permanent row lock |
| `sql/supabase-jadual-setup.sql` | **3rd, optional** — shared inspection schedule |
| `sql/supabase-audit-setup.sql` | **4th** — `updated_by` + a trigger that stamps it from the login token |
| `sql/supabase-hardening.sql` | **5th, optional** — closes the PostgREST RPC endpoints on the two `SECURITY DEFINER` functions. `authenticated` **must keep** `EXECUTE` on `is_admin()`; see §5 |
| `package.json` | Dev tooling only — `playwright` and the `npm test` scripts. The app still has no build step and nothing from `node_modules` is ever published |
| `.github/workflows/tests.yml` | Runs all three suites on every push/PR. Also `workflow_call`, so the publish gate can reuse it |
| `.github/workflows/publish-to-site.yml` | Copies `index.html`, `_headers`, `vendor/` to the **site repo** on every push to main — **but only after `tests.yml` passes** (`needs: test`) |
| `drafts/dashboard-draft-glass.html` | Standalone dashboard design draft (superseded by the real thing, kept for reference) |
| `docs/FULL-ARCHITECTURE.md` | How the system is built — layers, data model, every RLS policy, the key flows, deploy pipeline, and §9 known defects |
| `docs/PRD.md` | What it is for and where it goes — requirements, open issues, district-expansion analysis, non-technical risks, roadmap |
| `docs/epilibomba-spec.md` | Earlier design spec |

### Data
- **187 hydrants** — 170 Awam (`status='kerajaan'`) + 17 Swasta (`status='swasta'`:
  A26 and A92–A107, all at Kilang T.S.H Wilmar).
- Labels zoned: `A**` Kunak town, `B**`, `C**`, `D**` Madai, `E**` Pangi.

### Security model
- Any signed-in user **reads**; only `admin` **writes**. Enforced by RLS.
- New accounts default to `viewer`. Promote:
  `update public.profiles set role='admin' where email='...';`
- **Signed record rows are permanent** — RLS policy *and* an independent
  trigger. Signature images are upload-only, never replaceable.

---

## 2. The Dashboard (built this session)

Second tab in the header: **Peta Pili** | **Dashboard**.

### The key architectural decision
The dashboard does **not** store its own numbers. It derives them from the same
**Pengujian** rows the record card already writes:

- **Diperiksa** — a Pengujian row in the period, **signed**
- **Belum di-sign** — a row in the period, not yet signed
- **Belum diperiksa** — no Pengujian row in the period

One source of truth, nothing to drift. Reads localStorage synchronously, merges
the cloud copy when it arrives, and shows which source is in use.

### Features
- **3D donut** — upright ring, squashed horizontally, extruded to the right.
  Real projected geometry (top face + outer/inner walls + cut faces), not a fake.
- **Entry animation** — sweeps 0→360° and counts every figure up from zero,
  only when the tab is opened.
- **Clickable everywhere** — donut labels and status rows filter the map;
  any Lokasi searches the map.
- **Period** — rolling 6-month half, current plus three archived.
- **Jadual Pemeriksaan** — shared via Supabase, admin-only writes.

### Donut geometry (for future edits)
Oblique projection: a point at (radius `r`, angle `a`, depth `z`) lands at
```
x = CX + r*K*cos(a) + z
y = CY + r*sin(a)
```
Constants: `CX=250 CY=190 R=138 RI=R*0.60 K=0.70 DEP=16 START=-90 GAP=5`

Visibility is **derived, not guessed** — guessing produces phantom faces at
certain data splits:
- outer wall visible where `cos(a) > 0` → band `[-90, 90]`
- inner wall visible where `cos(a) < 0` → band `[90, 270]`
- start cap visible where `sin(a0) > 0`
- end cap visible where `sin(a1) < 0`

Draw order: caps → walls → top faces (painter's algorithm).

---

## 3. Design decisions (locked, with reasons)

| Decision | Choice | Why |
|---|---|---|
| Two repos | `claude_code` builds, **`ibrahimismail-IM33/e-pili-bomba` is what Cloudflare publishes** | They drifted 7 commits apart once and officers used a live app missing fixes. A workflow now copies the three published paths on every push to main, and refuses to publish if a CDN tag reappears or `sql/`/`tests/` would go public |
| CI | `tests.yml` runs all three suites on every push, and `publish-to-site.yml` **calls it and depends on it** (`needs: test`) rather than duplicating the steps | The suites existed for months and nothing ran them, while publishing was automatic — so the guarantee was "these bugs won't come back if someone remembers". The gate, not the workflow, is the deliverable: a CI job that reports red while the broken build ships anyway is decoration. Reusing the workflow via `workflow_call` means there is one definition of how tests run, so the gate cannot drift from the thing it is gating |
| Audit identity | Taken from the **JWT inside the database**, never from the request body, no fallback | A first version had `coalesce(jwt_email, new.updated_by)`, which let a modified page write any name it liked. Caught in testing. An audit column the client can set is decorative |
| Third-party libraries | **Self-hosted in `vendor/`**, no CDN, no SRI needed | A script from unpkg/jsdelivr runs with full access to the signed-in session and every record card, and `@supabase/supabase-js@2` floated — whatever the CDN called "latest 2.x" reached every officer with no review. Self-hosting removes the path entirely and lets CSP `script-src` drop to `'self'`. Versions pinned in `vendor/README.md` |
| Signature links | Card requests a **1-hour signed link** when it opens; falls back to the stored value if signing is unavailable | Lets the bucket be locked down without a moment where signatures fail to display — which matters because the change was made while officers were using the app. New signatures store the **path**; rows signed earlier hold a full public URL and the path is extracted from it |
| Card redraw | Only when the cloud copy **differs** from what is on screen (`formFingerprint`) | The card drew twice on every open — once from cache, once from the cloud — which reads as a blink on a phone. The two copies are usually identical, so the second draw was pure flicker |
| Bucket flip | **Client first, bucket second** | Flipping the bucket while officers are on the old build would break every signature on screen. The client change is backwards compatible, so it can go out on its own and the bucket follows once it is live |
| Chart palette | Cream `#FDF0D5` / steel `#669BBC` / navy `#003049` | User-supplied. Ordered lightest = most complete |
| Navy as text | **Never** — substitute `#9CAAB6` | Navy is 1.42:1 on dark, unreadable. Fill-only colour |
| Figure ink | Green `#4ADE80` / blue `#60A5FA` / red `#F87171` on the **card numbers and the chart percentages only** | Status reads at a glance: pass / pending / outstanding. Measured on the card base `#121419` — 10.6 : 7.3 : 6.7, all above 4.5:1. The donut fill and the word under each percentage keep the cream/steel/`#9CAAB6` ink, so a label still matches the slice its leader line points at |
| Figure glow | Subtle. `text-shadow` on the cards, `filter:drop-shadow` on the SVG | SVG text does not take `text-shadow` reliably across engines; `drop-shadow` does. Kept low so digits stay crisp on a phone in sun |
| Chart form | Flat-shaded 3D donut, upright, depth right, 50% depth | Matches supplied reference |
| Glass / glassmorphism | **Removed** | User asked for flat |
| Chart background stage | **Removed** | Card matches the rest |
| Card wrappers (chart + status) | **Removed** | User asked |
| Lokasi links | Plain coloured text, no icon, no box | Colour is the affordance |
| Lokasi target | Place-name search, not one hydrant | A visit covers a place, which may hold several pili |
| No. Pili in Jadual | **Removed** from table and form | User asked |
| Jadual permissions | Admin only | Matches hydrants and records — one permission model |
| Jadual "done" tick | **No** | The signed Pengujian row already proves it. A second flag would drift |
| Jadual order | **Latest Tarikh first** (descending date) | Supersedes both earlier orders (upcoming-first, then newest-entry-first). Dates are ISO strings, so a string compare *is* a date compare — no parsing, no timezone. Rows sharing a date keep the newest entry on top. Past dates still carry the `lepas` tag wherever they sit |
| Lokasi master | The **Kad Rekod** wins — saving the card writes `hydrant.location` | User's call. The popup, registry, search and every dashboard Lokasi link read that one field, so they all follow. A blank card field never overwrites, so clearing it cannot wipe a registered address |
| Offline saves | **Parked in `bbpkunak_pending_<id>`**, pushed automatically on reconnect | A failed save used to live only in the form cache, which `openForm` then overwrote with the cloud copy — losing the typing from screen and device without ever reaching the server. See §4.10 |
| Clearing a row | Sent as a **DELETE**, not an empty row. Admin only, no confirmation prompt, and the row stays drawn as an empty row in its position | An empty row is still a row, and the dashboard counts Pengujian rows — writing blanks would have needed the scan re-examined. Deleting keeps the table sparse and the dashboard corrects itself for free. Signed rows are never touched, by policy, by trigger, and now by the client refusing to ask |
| Pin date badge after a clear | Follows the Pengujian rows that remain; blank once none are left | `syncLastInspected` used to return early on a blank date, so the map advertised an inspection the record no longer held while the dashboard — reading those same rows — said "Belum diperiksa". Forcing it blank while dated rows still exist would recreate that same split |
| Offline conflict | **Cloud wins, officer is warned** and shown what they typed | User's call. Silently picking a winner is what caused the loss. A row nobody else touched is pushed without any warning at all |
| Unsent work | Banner on the card **and** an amber `!` on the map pin | An officer should not have to open every pili to find what has not synced |
| Cross-device refresh | Re-read on foreground/focus/online, **plus a 60s poll while visible** | The app read the cloud once at startup and then showed its cache, so a second device only caught up when you opened each hydrant by hand. Foreground alone is not enough — a device left open on the counter never fires one. Throttled to one pull per 10s; nothing runs while the tab is hidden |
| Background pull and the map | **Never re-fits the view** (`cloudLoad(quiet)` + `noFitOnce`) | A pull that brings a hydrant someone else added changes the fit key, and a re-fit would jump the map away from what the officer is reading |
| Dashboard scope | Follows the Awam/Swasta pills, incl. cleared = Semua | Must match the map exactly |
| Mobile header | Hamburger menu for account actions; tabs left-aligned with pills | User sketch |
| Mobile kicker | Shows **"BBP KUNAK"** only; `· Sabah · Bomba Malaysia` hidden | Full string is ~200px and forced an extra header row. Short form costs nothing |
| Zoom buttons | 34px on mobile | User asked, and confirmed fine in the field. Below the 44px touch minimum — accepted |
| Archive on period reset | Keep the **full hydrant list** | Already inherent: the dashboard recomputes per hydrant from dated `hydrant_records`, so an archived period keeps full detail and its status filters still work on the map |
| Jadual folders | One per period, decided by the row's **Tarikh** | Rollover needs no migration — the date decides which folder a row belongs to |
| Jadual page size | 100 rows + "Lihat semua" | Bounded, but nothing is ever hidden — the rest are one tap away |
| Jadual past periods | Still editable by admin | User's call |
| Jadual edit control | **Icon only** (pencil SVG), admin only, beside delete | User asked. `title` + `aria-label` carry the meaning; the column stays narrow |
| Edit form | **Reuses the add form** — button flips to "Simpan", "Batal" appears | One set of fields and one set of validation, nothing to keep in step |
| Delete confirm | Added `confirm()` | Delete now sits one button away from edit and cannot be undone. Gap raised 2px → 6px for the same reason |
| Jadual date filter | **Removed** | Built, then the user asked for it gone — the period selector plus a date-sorted list is enough. Don't re-add it without being asked |
| Open edit on period change | **Dropped** | An edit belongs to the period it started in |

---

## 4. Bugs found and fixed (worth remembering)

1. **Unbounded query** — Supabase caps a request at 1000 rows. The dashboard
   scan pulled every Pengujian row in one go; past 1000 rows (187 hydrants ×
   15/page reaches it easily) the extras were dropped and those hydrants
   silently counted as "Belum diperiksa". Would have read ~67 hydrants and
   reported 120 as never inspected. **Now pages through, ordered by
   hydrant_id + row_index** so `range()` can't repeat or skip.

2. **Pills didn't update the dashboard** — the pills sit in the shared header
   and can be tapped while the dashboard is showing, but their handler only
   called `refresh()`, which never touched the dashboard. `activeFilter`
   changed while the figures sat there unchanged.

3. **Cleared state reported the wrong scope** — with no pill selected the map
   shows all 187 but the dashboard silently said "Awam". Old code only asked
   "is it swasta?" and let everything else fall through.

4. **Fixed segment gap swallowed small slices** — a 5° gap dropped any category
   under ~2%, so "Diperiksa" at 1.2% vanished entirely. Gap now scales with
   slice width.

5. **Labels clipped** — with two labels on one side the second fell outside the
   viewBox. The viewBox now sizes to the labels actually drawn.

6. **Stat title/description collided** — inherited inline `<span>`s. Also
   `.stat` is a `<button>`, which does **not inherit page colour**, so titles
   fell back to the UA default and washed out.

7. **CSS source-order bug** — the `.menubtn{display:none}` base rule sat *after*
   the mobile `display:flex` override. Same specificity, later wins.

8. **Stacking context** — `header{z-index:20}` formed a context the account
   dropdown couldn't escape, so `.searchrow` (500) painted over it. Header
   raised to 1000 (still below modals 9999, form 12000, gate 100000).

9. **Horizontal overflow on phones** — the 5-column table pushed the page to
   438px on a 390px screen. Tables now scroll inside `.dtwrap`.

---

10. **Offline field data was destroyed silently.** An officer fills a card
    with no signal; the save fails and says "⚠ Local only"; the card sits in
    localStorage looking safe. The next time that card is opened with a
    working connection, `openForm` rebuilds it from the cloud and writes that
    back over the cache — the typing is gone from the screen *and* the
    device, and never reached the server. Reproduced end to end. The
    overwrite itself was deliberate (so rows an admin deleted cannot linger);
    the offline case had simply not been considered. Now a failed save is
    parked with the cloud values it was based on, pushed automatically when
    the connection returns, and only genuinely contested rows are held back
    and shown to the officer. Guarded by `tests/p0-offline-sync.js`.

11. **The nightly backup did not include the signature images.** It dumped
    `public` and `auth.users` only; the images live in Storage, outside both.
    8 files, 1.1 MB, and every signed record depends on one — a restore would
    have produced records claiming to be signed and pointing at dead links.
    The signature *is* the evidence, so this was the largest blast radius of
    anything found in the audit. The workflow now downloads them into the same
    artifact with `storage-objects.csv` to match file to record, needs no new
    secret (list from `storage.objects` over the existing DB URL, bucket is
    public), and fails loudly if any image is missing. **If the bucket is ever
    made private this step needs a service-role key.**
12. **A failed backup told nobody.** It now opens or comments on an issue
    labelled `backup-failure`, which needs `permissions: issues: write` on the
    job — without that the alert itself fails silently.

13. **A row could never be cleared.** Found in the field 2026-08-04: clear a
    row on the Kad Rekod, save, reopen — the data is back. `cloudFormSave`
    only ever sent rows that still had content, and **an upsert does not
    delete what it is not sent**, so the row survived untouched. `openForm`
    then rebuilt the card from the cloud — working exactly as designed, and
    the comment there even says it exists so cleared rows cannot linger — and
    restored it to the screen *and* to localStorage. There was **no
    `.delete()` on `hydrant_records` anywhere in the app**; the only delete in
    the file was for the jadual. Clearing was not broken, it had never been
    implemented. On a legal inspection record an entry that cannot be
    withdrawn is worse than one that is missing. Guarded by
    `tests/clear-row.js`.

14. **A failed flush threw away the parked work.** Found while fixing 13.
    `flushPending`'s `finish()` saved only `keep`, so if the upsert failed the
    pushed rows were dropped from the pending queue — leaving the typing in
    the form cache, no longer flagged as unsent, and overwritten by the cloud
    on the next open. That is precisely the P0 (§4.10) reappearing on any
    flaky connection, as opposed to a clean outage. **A flush that fails must
    now change nothing.**

## 5. Things I got wrong (so they aren't repeated)

- **Overstated a CSS collision risk.** I claimed `table/th/td` was "especially"
  risky because the record card uses tables. Wrong — every record-card table is
  `.ftab th/.ftab td`, and class specificity (0,1,1) beats a bare element
  selector (0,0,1). The **genuine** collisions were `.card` (registry card),
  `.btn` (modal buttons) and `.pill` (Awam/Swasta). Scoping under `#dashView`
  was still right, but it was routine hygiene, not a near-miss.
- **Asserted before checking.** The lesson that keeps paying: measure in a real
  browser, don't reason from the screenshot.
- **Shipped an audit column the client could forge.** The first version of
  `stamp_row_audit()` used `coalesce(jwt_email, new.updated_by)`, so a modified
  page could write any name into the audit trail. Caught only because the test
  planted `liar@example.com` and checked it was rejected — testing the happy
  path would have passed. An audit field must take identity from the token and
  never fall back to the request body.
- **Shipped a workflow that could never run.** `publish-to-site.yml` had a
  multi-line commit message inside a `run:` block, which ends the YAML block
  scalar and corrupts everything after it. GitHub registered the file and
  said nothing; the only tell was the Actions list showing the **file path**
  instead of the workflow name, and `workflow_dispatch` being rejected as
  "not a trigger". **A workflow displaying its path as its name is an
  unparseable workflow.** Validate with `yaml.safe_load` before pushing, and
  never interpolate `github.event.*` text into a shell script — pass it as an
  env var, or a commit message containing backticks executes as code.
- **Nearly locked every officer out, on a "harmless" tidy-up.** The plan for
  the RPC hardening said to `revoke execute on function public.is_admin() from
  anon, authenticated`, reasoning that a `SECURITY DEFINER` function runs as its
  owner so the RLS policies would be unaffected. **Wrong.** An RLS policy
  expression is evaluated as the *calling* role, so without that grant every
  policy calling `is_admin()` fails with `permission denied for function
  is_admin` and no admin can write anything. Caught only because the change was
  run against a real Postgres and an admin insert was attempted — the
  verification query alone said `callable_by_api = f` and looked like success.
  `authenticated` **must keep EXECUTE**; revoke from `public, anon` only.
  `handle_new_user()` is different and can be closed to everyone, because it is
  only ever invoked by the trigger, as the trigger's owner.
- **Recommended work I could not finish.** I proposed creating a scratch
  Supabase project for a restore test "then deleting it" without first checking
  that I had a way to delete it, or a token to download the backup artifact. I
  had neither. Check the whole path is available before recommending it.

---

## 6. Performance

Entry animation profiled with CPU throttling. Budget for 60fps is 16.7ms/frame.

| CPU | Frames | Total main-thread | Avg | Worst | Dropped |
|---|---|---|---|---|---|
| Normal | 53 | 57 ms | 1.1 ms | 4.5 ms | **0** |
| 4× slower | 38 | 194 ms | 5.1 ms | 11.1 ms | **0** |
| 8× slower | 25 | 225 ms | 9.0 ms | 15.9 ms | **0** |

**Zero ongoing cost** — 0 rAF callbacks measured in the 2s after it settles.

Kept cheap by: coarsening arc sampling 2°→6° during the sweep (restored for the
final frame), event delegation instead of re-attaching listeners each frame,
time-based rAF so a slow device draws fewer frames rather than running longer,
and stable label layout so labels only fade rather than re-flow.

The animation fires **only when the Dashboard tab is opened**, never during map
init, so it can't compete with 187 markers loading.

---

## 7. Still open

Nothing blocking. Everything raised so far has been decided — see §3.

Watch items:
- **Keep `sql/` in step with production.** The signatures bucket was made
  private live, and the script was left creating it as `public = true` with an
  anon-readable policy — which would have silently re-exposed every signature
  during a recovery, because `RESTORE.md` makes re-running `sql/` mandatory.
  Backported 2026-08-04, and the verification query now reports
  `bucket_is_private` and `read_is_authenticated_only` so the same drift shows
  up next time. **The DR scripts are not documentation — they are what a
  recovery actually applies. Change production, change the script.**
- **Still open from the audit** — 7 of 8 accounts are admin (user chose to
  keep roles and add the audit trail instead); `SECURITY DEFINER` functions are
  exposed as RPC (search_path is pinned, so no escalation path);
  leaked-password protection is off; `cloudLoad` and `cloudFormLoad` are still
  unbounded (latent at 1000 rows).
- **Restore is verified and now automatic.** `restore-test.yml` in the site
  repo runs every Monday: downloads the newest backup, restores it into a
  throwaway Postgres, checks the counts and the signature images, and opens
  an issue on failure. First verified run 2026-08-03 — 188 pili, 31 rekod,
  8 bertandatangan, 8 valid images.
- **A restore does NOT bring back the security layer.** Proven by that run:
  16 statements fail on a bare Postgres — every RLS policy plus the
  `profiles → auth.users` link, because there is no `authenticated` role and
  no `auth` schema. Re-running everything in `sql/` is a mandatory recovery
  step, not a tidy-up; skipping it leaves every record writable by anyone
  signed in.
- **Backup retention is 90 days** in GitHub artifacts, which vanish with the
  repo. Consider a copy held elsewhere.
- **Publishing is automatic** — `publish-to-site.yml` copies `index.html`,
  `_headers` and `vendor/` to the site repo on every push to main, using the
  `SITE_REPO_TOKEN` secret. Verified working 2026-08-03. Do not hand-copy.
- **An open record card does not refresh** while it is open. It re-reads on
  open, which is enough, and refreshing under someone would throw away what
  they are typing. Left deliberately.
- **Jadual over 1000 rows in one period** — the query is filtered to the
  selected period and capped at 1000. Far beyond realistic volume for six
  months, and if it ever hits the cap the header says so rather than
  undercounting quietly. Paginate if it becomes real.

---

## 8. Verified vs not

**Verified in a real browser** (Playwright, Chromium):
- Lokasi sync: card save updates the hydrant, sends the upsert, and the popup
  and place search both follow
- Cross-device: a remote edit + signature appears on the second device on
  foreground and again on the idle 60s poll, dashboard figures move with it,
  and `fitBounds` is called 0 times during a background pull
- Figure ink and glow: computed colour on all six figures (3 cards + 3 chart
  labels), contrast measured against the real card background, donut segment
  fills confirmed unchanged
- Dashboard figures from real Pengujian data, all scope states (Semua/Awam/
  Swasta) reconciling to their totals
- Pagination against 2400 rows over 160 hydrants — 3 requests, exact counts
- Both routes to the map (status filter, Lokasi search)
- Jadual in all three states: no cloud, cloud-but-table-missing, cloud working
- Jadual edit: form loads the row, `update` (not `insert`) is sent, row count
  unchanged, form resets, Batal restores it; delete confirm dismiss/accept
- Jadual order: latest date first, same-date tie broken by newest entry, and a
  mid-range date added slots in by date rather than jumping to the top
- Mobile at 360/390/430px — no horizontal overflow, alignment measured
- Account menu opens/closes, and its items work despite standing in for
  `display:none` buttons
- z-index regression: modal, login gate, header/search boundary
- Animation cost under CPU throttling

**Confirmed on the live site (2026-08-02):**
- Dashboard header reads **"Data awan ✓"** — the real Supabase round trip works
- Dashboard → Peta Pili returns a full map, no grey sliver
- Zoom buttons at 34px are fine in the field

**Confirmed on a real phone in the field (2026-08-04)** — the first time any of
this was checked outside a headless browser:
- **The offline round trip.** Aeroplane mode: the app opens and is fully usable
  with no network, an edit parks, the pin shows the amber `!` and the tooltip
  says *Belum dihantar ke pelayan*. Reconnect: the badge clears and the data is
  on the server, confirmed from a second device
- Stale `bbpkunak_pending_*` entries left by an earlier admin session on the
  same browser clear themselves on the next flush — `!` shows for a second or
  two on first paint, then goes. The flush only needs a SELECT, which is why a
  viewer account clears them fine
- **Clearing a row did nothing** — see §4.13. Found by trying it

**Committed regression tests** (`tests/`, see `tests/README.md`):
- `csp-and-vendor.js` — 21 assertions: no CDN tag or CDN origin left anywhere,
  every vendor file present, and the app booted under the **real CSP read from
  `_headers`** with the real Leaflet — 187 pins in 7 clusters, zoom control,
  Supabase client, zero CSP violations, zero page errors
- `clear-row.js` — 27 assertions over 7 scenarios: a cleared row is actually
  deleted, signed rows are never touched, clearing works offline and warns on
  a contested removal, the pin's date badge follows the rows that remain, and
  a failed flush changes nothing. **Verified to fail on the pre-fix code —
  10 red.**
- `p0-offline-sync.js` — 20 assertions over 5 scenarios: offline edit
  survives and reaches the server, contested row warns instead of
  overwriting, signed rows are never touched, reconnect pushes without the
  card being opened, ordinary online saves unchanged. Verified to **fail on
  the pre-fix code** — a test that passes on the bug guards nothing.

**Still only tested against a stand-in client:**
- The jadual table's own round trip (`gte`/`lte` period filter, insert, delete).
  Logic and payloads verified; run `supabase-jadual-setup.sql` then add a row and
  confirm it appears on a second device.

---

## 9. Deploy

1. Supabase → SQL Editor: `supabase-setup.sql`, then
   `supabase-records-setup.sql`, then optionally `supabase-jadual-setup.sql`
   (all safe to re-run; the jadual one is optional — without it the schedule is
   per-device and the app says so).
2. Accounts: Authentication → Users → Add user, tick *Auto Confirm*. Promote
   admins with the SQL above. **Give everyone their own login** — signatures
   record who signed, which is meaningless on a shared account.
3. Publish `index.html` + `_headers`. No new external origin was added, so the
   CSP needs no change.

---

## 10. Conventions

- Colour carries **meaning**, never decoration.
- The whole app is **one product** — no theme split between tabs.
- Optimise for **phone in the field**: large targets, no zoom-on-focus, no
  sideways scroll, high contrast.
- All dashboard CSS is scoped under `#dashView`. Keep it that way — the app's
  CSS is global and `.card`, `.btn`, `.pill` are already taken.
- Verify in a browser before claiming something works.
