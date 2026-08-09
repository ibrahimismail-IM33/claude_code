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
- **A V2 migration is under way on `claude/epb-v2`** (Vue 3 + Vite + Pinia,
  `docs/V2-ROADMAP.md`). It changes nothing an officer sees and it is held back
  from `main` until cutover. If you are fixing V1, keep working in `index.html`
  as before — but merge that fix **down** into `claude/epb-v2` afterwards, never
  the other way, or the cutover will quietly revert it.

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
| `sql/supabase-hardening.sql` | **5th, optional** — closes the PostgREST RPC endpoints on all five `public` functions. `authenticated` **must keep** `EXECUTE` on `is_admin()`; see §5 |
| `package.json` | Dev tooling only — `playwright` and the `npm test` scripts. The app still has no build step and nothing from `node_modules` is ever published |
| `.github/workflows/tests.yml` | Runs all seven suites on every push/PR. Also `workflow_call`, so the publish gate can reuse it |
| `.github/workflows/publish-to-site.yml` | Copies `index.html`, `_headers`, `vendor/` to the **site repo** on every push to main — **but only after `tests.yml` passes** (`needs: test`) |
| `drafts/dashboard-draft-glass.html` | Standalone dashboard design draft (superseded by the real thing, kept for reference) |
| `v2/`, `vite.config.mjs` | **V2 migration only** (Vue 3 + Vite + Pinia). Reaches no officer until cutover — `main` publishes V1 throughout. See `docs/V2-ROADMAP.md` |
| `docs/V2-ROADMAP.md` | The V2 plan: why, the phase order and what it is ordered by, the branching model, and what is explicitly out of scope |
| `docs/STAGING.md` | **How V2 staging is deployed and what it is safe to do on it.** Cloudflare Pages builds `claude/epb-v2` directly; the suites do **not** gate that deploy, and staging writes to the **production** database. Read it before pointing anyone at the staging URL |
| `docs/CUTOVER.md` | **The ordered checklist for putting V2 in front of officers**, with the rollback. Read §1 first: `publish-to-site.yml` is V1-shaped and **cannot publish V2** — it does not even trigger on a V2 change, so merging alone leaves officers on V1 while everything reports success |
| `scripts/verify-bundle.js` | Runs as the last step of the Cloudflare build. A non-zero exit fails the deployment, so it is the gate on the built artefact — no harness page, no CDN origin, `script-src 'self'`, `noindex`, `geolocation=(self)` |
| `docs/DOM-CONTRACT.md` | **The selectors the test suites depend on.** V2 must emit them exactly — they are an interface, not implementation detail |
| `docs/FULL-ARCHITECTURE.md` | How the system is built — layers, data model, every RLS policy, the key flows, deploy pipeline, and §9 known defects |
| `docs/PRD.md` | What it is for and where it goes — requirements, open issues, district-expansion analysis, non-technical risks, roadmap |
| `docs/KAD-REKOD.md` | **Binding spec for the record card.** MANDATORY under MS ISO — 2 pages, row capacities, how a new card is created, numbering, screen-vs-print order, signature permanence. **Read this before touching the card or the print CSS** |
| `docs/epilibomba-spec.md` | Earlier design spec |

### Data
**No live count is written here.** It changes every time an officer taps Tambah
Pili, and a number copied into a document goes stale without anyone noticing —
this section claimed 187 for weeks while the register held 188, then 203.
`docs/PRD.md` §5 does the same thing for the same reason. Read it instead:

```sql
select status, count(*) from public.hydrants group by status;
```

Facts that do **not** drift:
- `sql/supabase-setup.sql` **seeds 187 rows** — 170 Awam (`status='kerajaan'`)
  + 17 Swasta (`status='swasta'`). A fact about the file, not a claim about
  today. **Do not "correct" it to match the register** — that script is what a
  recovery actually applies.
- **Swasta** are A26 and A92–A107, all at Kilang T.S.H Wilmar.
- Labels zoned by leading letter: `A**` Kunak town, `B**`, `C**`, `D**` Madai,
  `E**` Pangi. Zones are **derived from the label**, never stored (§3), so they
  cannot go stale the way this line did.

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
- **Nombor Pili Terkini** — beside Pemeriksaan terkini. One row per zone with
  its number range and count, derived from the label prefix. Tapping a row
  filters the map to that zone.
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
| Two repos | `claude_code` builds, **`ibrahimismail-IM33/e-pili-bomba` is what Cloudflare publishes** | They drifted 7 commits apart once and officers used a live app missing fixes. A workflow now copies the three published paths on every push to main, and refuses to publish if a CDN tag reappears or `sql/`/`tests/` would go public. **Applies to V1. At V2 cutover this is superseded — see the next row** |
| V2 publishing | **Cloudflare Pages builds `claude_code` directly** and serves `dist/`, like staging. The site repo is no longer the source for epilibomba.com | `publish-to-site.yml` cannot publish V2 at all: no build step, and V2's app is a Vite bundle under `v2/` rather than the three paths it copies. Teaching it to build was the alternative and was declined for the simpler route. **The cost is real and was accepted knowingly: `tests.yml` stops gating what officers receive** — Cloudflare deploys every push, green or red. `verify-bundle.js` still fails the deployment on a bad artefact, so a malformed bundle cannot ship; a logic regression can. `docs/CUTOVER.md` §7 is how to take the gate back (build a `release` branch that CI fast-forwards only when the suites pass) |
| Rollback from V2 | **Move the custom domain back to the old Pages project.** So the old project, the `e-pili-bomba` repo and `publish-to-site.yml` all stay | No build, no revert, no deploy — the site repo still holds V1 exactly as officers used it, and the workflow keeps it current. A git revert would need a rebuild and a redeploy while officers wait |
| `X-Robots-Tag` | **Branch-aware at build time** (`scripts/finalize-headers.js`), and `v2/public/_headers` **keeps** the `noindex` line | One file now feeds two environments: staging must stay unindexed (real data, real logins), production must not be. The line stays in the source so the safe default is what you get by doing nothing — any future branch or preview is private unless told otherwise. Production is identified by `CF_PAGES_BRANCH`, which Cloudflare sets itself, so there is no dashboard variable to forget. `verify-bundle.js` re-checks the outcome independently: one script decides, the other refuses to ship the wrong answer |
| `login-bg.jpg` | **Lives in `v2/public/`, referenced as `url("/login-bg.jpg")` — root-absolute** | It used to exist only in the site repo, copied separately, so a Cloudflare build of this repo shipped without it. And the leading slash is load-bearing: the built stylesheet is `/assets/style-*.css`, and a relative `url()` resolves against the **stylesheet**, so `url("login-bg.jpg")` requests `/assets/login-bg.jpg`. Both failures are **invisible** — `#authGate` declares `#0a0b0d` too, so a missing image degrades to a dark panel that looks deliberate |
| CI | `tests.yml` runs every suite on every push, and `publish-to-site.yml` **calls it and depends on it** (`needs: test`) rather than duplicating the steps | The suites existed for months and nothing ran them, while publishing was automatic — so the guarantee was "these bugs won't come back if someone remembers". The gate, not the workflow, is the deliverable: a CI job that reports red while the broken build ships anyway is decoration. Reusing the workflow via `workflow_call` means there is one definition of how tests run, so the gate cannot drift from the thing it is gating |
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
| Charting library | **None — the donut stays hand-built.** Chart.js considered and declined 2026-08-07 | Chart.js has no 3D doughnut in v4 and no maintained plugin for one, so adopting it means shipping a flat 2D chart — a **redesign**, which V2 excludes. The generator is 8.4 KB, dependency-free, frozen, and proven character-for-character identical to what officers see; Chart.js is ~70 KB gzip and nothing comparable could be proven about it. Reconsider for **new** charts in V2.1 (trends, per-zone bars), where there is no design to preserve and no parity to lose. See `docs/V2-ROADMAP.md` |
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
| Nombor Pili Terkini scope | **The one exception — always the whole register**, ignores the pills | It answers "what number does the next pili get?", which is a fact about the register, not about a filter. Following the pills would make zone A's range jump between A114 and A91 as Swasta is toggled, and "the last number" would stop meaning the last number. The panel says so in its caption |
| Zone data | **Derived from the label's leading letter**, never stored | Zones did not exist in the code at all. The user's hand-written table was already a row ahead of the repo's seed before it was written down — a stored copy ships stale. Deriving also makes "update when tambah pili" free (`refresh()` already runs after an add) and gives a brand-new zone letter its own row with no migration |
| Zone as a filter | **Stacks** with Awam/Swasta and inspection status | Those two already combine with AND. A third axis behaving differently would be the surprise. Zone A + Awam = 97, which is correct, not a bug |
| Zone rows vs odd labels | **No row**, but reported in the caption | User's call — zone rows only. But the add form validates the label as non-empty and nothing else, so a typo can exist. A panel whose rows silently sum to less than the register is misinformation, so the count of unparsed labels is stated rather than a "Lain-lain" row added |
| Zone range vs count | **Both shown, and flagged when they disagree** | A range implies contiguity. Every zone is gap-free today, so the warning is dormant — but delete one pili and `A01 – A114` would keep claiming 114 |
| Zone panel markup | **Buttons, not a table** | `#dashView table` carries `min-width:460px` for the wide record tables; reusing it inside the narrow grid column would push the page sideways on a phone — §4.9 again |
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
| Kad Rekod card order | **Newest first on screen, oldest first in print** | The newest card is the only one anyone writes on, so an officer should land on it rather than scroll past years of filled cards on a phone. Paper is the opposite: a filed record reads forward in time. Done with `flex-direction:column-reverse` on `.fsheet` while the **DOM stays chronological** — reversing the render loop would reverse the paper too and break the `page-break-before` rules, and that failure is invisible on screen |
| Kad Rekod card numbers | **Permanent and chronological** — oldest is always Kad 1 | The card is auditable. A card signed and filed as *Kad 2* must still be Kad 2 next year. Numbering by screen position was rejected: it renumbers signed cards, and with print staying oldest-first it would make the printed stack count **down** (3/3, 2/3, 1/3). `TERKINI` marks the newest instead, and is hidden in print |
| New card trigger | **Last row of any section complete, on save** | Was: any character in the last row. A half-typed row is not a record, and a card created by one stray keypress is a card the officer has to explain. "Complete" is Tarikh **plus one other field** — demanding every column would strand an officer who leaves `Catatan` blank with nowhere to write. Fires on the **local** save, so it still works with no signal |
| Kad Rekod spec | Written down in `docs/KAD-REKOD.md`, marked **MANDATORY** | The rules — 2 pages, the mm-tuned row heights, capacities, numbering — lived only in the user's head and two code comments. It is the part of the app most likely to be "tidied" by someone who does not know it is a legal record, and the only part where a mistake is invisible until it reaches paper |

---

## 4. Bugs found and fixed (worth remembering)

1. **Unbounded query** — Supabase caps a request at 1000 rows. The dashboard
   scan pulled every Pengujian row in one go; past 1000 rows (the register ×
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

15. **The fix for the faded signature printed a black box.** Found on paper
    2026-08-08, on C26, one day after the faded fix was confirmed. The two are
    the same defect seen from opposite sides. `stripSignatureBg` keys the paper
    out with a *ramp*, so on a badly-lit photo the background is not removed —
    it is left at low-but-non-zero alpha. The print filter was three stacked
    `drop-shadow` passes whose entire purpose is to **compound partial alpha
    toward 1**; that is what made the ink solid, and it did exactly the same to
    the leftover paper. Measured: the print went from **5.7% dark to 95.8%**.

    Three things are worth carrying forward:

    - **"Just thicken the stroke" was the wrong lever twice** — it does not
      touch the cause (background alpha being multiplied up), and a capture-side
      change repairs no filed record, because a signed row's image can never be
      re-uploaded. The same constraint that made the first fix render-side.
    - **Neither a CSS nor an SVG filter survives `page.pdf()`.** The shipped
      filter was tested as a control and came out unfiltered, despite being
      confirmed black on a real printer. So the fix is not a filter at all:
      `signatureForPrint()` thresholds alpha in a canvas and prints a plain
      PNG, leaving the print pipeline nothing to drop.
    - **The threshold has to be relative.** An absolute 0.65 erased a signature
      whose ink sat at alpha 158. It is now 0.65 **of the image's own strongest
      alpha**. A signature missing from a filed record is worse than either
      defect it replaces.

    The test lesson is the sharper one. T7 asserted the ink reaches black — and
    **a solid black box satisfies that perfectly**, which is why the first fix
    shipped green. It now measures the *fraction* of dark pixels, and its
    fixture carries residue: a clean fixture cannot reproduce this at all. Even
    the replacement was blind at first, because the box has *no grey in it*, so
    a grey-based check also passed on the bug. Verified red on the pre-fix code
    before being trusted: 6 assertions fail.

16. **The map would have tiled itself wrong after a tab switch.** A real parity
    gap, closed 2026-08-09 — but **latent, and not the defect seen on staging
    that day. See §4.17 for what actually caused those scattered tiles; this
    entry was originally written claiming that symptom and the claim was
    wrong.** **Leaflet mis-measures itself while hidden.** The map is
    deliberately kept mounted behind `v-show` so an officer keeps their pan,
    which means its container collapses to zero on the dashboard and Leaflet
    goes on believing that size when it returns.

    V1 already knew this — `setTab` calls `map.invalidateSize()` on the way
    back, with a comment saying why. V2 ported the mount-time calls and the
    resize listener but **not that one line**, so it was a parity miss rather
    than a new bug. MapView now watches an `active` prop and re-measures twice,
    because the container regains its size a frame or two after `v-show` clears
    `display:none`.

    Two things worth carrying, both about the *verification* rather than the
    fix:

    - **The mutation test lied, because the build had failed.** Deleting the
      watcher with a crude text slice broke the syntax; `vite build` exited
      non-zero, `dist/` kept the OLD bundle, and the suite happily passed
      against it. A mutation is only real if the artefact under test actually
      changed — **check the build succeeded before believing a green
      mutation**. Same family as `| tail` swallowing an exit code.
    - **The edit that "applied" did nothing.** The first attempt to insert the
      watcher replaced a line that no longer existed (it had been rewritten
      earlier into the combined `[visible, refit]` watcher), so the change
      silently vanished and only the failing test revealed it. Verify an edit
      landed; do not assume a string replace matched.

17. **Leaflet's own stylesheet was never imported, and the map was broken from
    first paint.** Found on staging 2026-08-09. The map rendered as scattered
    tiles with black gaps between them — *not* after a tab switch, but
    immediately on load, and **panning did not repair it**.

    V1 loads three stylesheets as `<link>` tags in `index.html`:
    `vendor/leaflet.css`, `vendor/MarkerCluster.css`,
    `vendor/MarkerCluster.Default.css`. **V2 imported none of them** — it
    bundles Leaflet's JavaScript and had done so since Phase 1, but nothing
    ever pulled in the CSS. Without it the panes and tiles never receive
    `position:absolute`, so the tiles are laid out in normal document flow.
    That also explains the second symptom exactly: panning applies a transform
    to a pane that was never positioned, so it moves nothing.

    Fixed by importing all three in `v2/src/main.js` and `v2/src/harness.js`.
    **They must sit before `map.css`** — `cssCodeSplit:false` concatenates in
    import order and `map.css` overrides `.leaflet-container`,
    `.leaflet-control-zoom a` and `.leaflet-tooltip`. Get the order wrong and
    the app silently reverts to Leaflet's light `#ddd` map background; that is
    a separate assertion in T8 and it was mutation-verified separately.

    Four things worth carrying:

    - **I mis-diagnosed it, and shipped the wrong fix first.** My first answer
      was the missing `invalidateSize` on tab return (§4.16). That gap was real
      and the fix is worth keeping, but it was **latent** and I presented it as
      the cause. The two facts that should have ruled it out were already in
      hand: broken *from first paint*, and *unchanged by dragging*. Stale
      measurement produces neither. **Before theorising about a library's
      internal state, check whether the library's own assets are present at
      all** — it is the cheapest question available and it was never asked.
    - **The whole suite was blind because the stub needs no CSS.** Every V2 map
      suite stubs `window.L`; the only suite booting the real library
      (`csp-and-vendor.js`) tests **V1**, where the `<link>` tags are right
      there. Same family as every other seam defect here: *the thing being
      stubbed was the thing that was broken*. `tests/v2-app-live.js` T8 now
      boots real Leaflet and asserts `getComputedStyle('.leaflet-pane').position
      === 'absolute'`.
    - **A dependency's stylesheet can vanish with nothing to show for it.** The
      build was green, the bundle well-formed, every assertion passed. Only a
      browser with the real library in it could tell. `scripts/verify-bundle.js`
      now fails the deployment if the built CSS carries no `.leaflet-pane`,
      `.leaflet-tile`, `.leaflet-cluster-anim` or `.marker-cluster-small` rule.
      The probes are deliberately selectors that exist **only** in the library
      files — `.marker-cluster` and `.leaflet-container` were rejected as
      probes because `map.css` defines them itself, so they would have passed
      on the bug.
    - **§4.16's lesson applied again, and paid.** Both mutations here were
      checked for `BUILD EXIT=0` before their red was believed.

18. **Every dashboard figure multiplied by the number of times the tab had been
    opened.** Found by an officer on the V2 build, 2026-08-09: the register of
    203 displayed as **1624**, and *Belum diperiksa* read **705.4%**.

    `sweep` is the entry animation's **progress, in [0, 1]**, and it is
    multiplied straight into every figure — `lib/donut.js` renders
    `Math.round(d.total * sweep)`, `StatCards.vue` renders
    `Math.round(data[k] * sweep)` and `(data[k] / total * 100 * sweep)`.
    `App.vue` passed an incrementing **counter**: `sweep.value++`, so 1, 2, 3 …

    Every number on the report is `×8`, the eighth open: 203→1624, 24→192,
    179→1432. **The entry animation had never actually been implemented** —
    nothing drove a value 0→1 over time. `lib/dash-anim.js` is what was missing,
    ported from V1's `dAnimate` (900ms, ease-out cubic, time-based rAF,
    `prefers-reduced-motion` honoured, in-flight run cancelled).

    Three things worth carrying:

    - **The first open was always correct**, because a counter's first value is
      1 and 1 is a valid progress. That is why staging looked right, why the
      printout gate passed, and why **965 assertions missed it: every test
      opened the dashboard once**. `tests/v2-app-live.js` T10 opens it three
      times, which is the entire difference between catching this and not.
      Same family as the clean signature fixture and the donut band in §5 — a
      fixture that cannot reproduce the defect proves nothing.
    - **The donut's percentages stayed correct throughout**, because `sweep`
      cancels in a ratio. Only absolute figures diverged, so a glance at the
      chart said everything was fine. A derived value that is invariant under
      the bug is not evidence.
    - **One of the new assertions passed on the bug, and nearly shipped.**
      "No percentage exceeds 100" was written against `.pct`; the class is
      `.pc`, so it selected nothing — and `[].every(...)` is `true`. An
      assertion over an empty set is not a weak assertion, it is **no**
      assertion. It now checks the set has three members first.

19. **Jadual Pemeriksaan was missing from V2 entirely.** Found in the same
    session. `jadual-logic.js` (parity-tested) and `Jadual.vue` both existed and
    were both correct. Nothing joined them: `App.vue` passed `:jadual="[]"`,
    bound no handler for the panel's add/update/remove events, and never passed
    `capped` or forwarded `pickLocation`. The panel rendered permanently empty
    and every write vanished silently.

    **Third instance of the join being the broken part** — after the `() =>
    'none'` dashboard stub and `records.load()` never assigning `this.form`.
    The store now exists (`stores/jadual.js`, ported from V1 including the
    per-period cache replacement and the 42P01-vs-connection distinction) and
    T11 drives the round trip through the assembled app.

    The recurring shape is worth stating plainly: **every component and every
    pure function can be right while the application does nothing.** Phase
    gates prove layers. Only a test that drives the assembled app proves the
    seams, and this suite has now found five defects that way.

20. **Every Kad Rekod printed with no section titles and no column headings.**
    Found on the V2 build 2026-08-09: the four yellow section bars were blank
    and every table was a grid of unlabelled columns.

    `KadRekod.vue` renders `SECTIONS[sec].title` and
    `v-html="SECTIONS[sec].thead"`. `records-logic.js` carried **neither**, and
    said so in its own header comment — *"the table markup (`thead`) stays in
    the view layer, where Phase 5 will deal with it; carrying it into a store
    would put print HTML somewhere no print test looks."* Phase 5 never did.
    Both resolved to `undefined`, `v-html` of `undefined` renders nothing, and
    nothing anywhere errors.

    Both now live in `SECTIONS`, **proved byte-identical to `index.html`** by
    evaluating V1's object literal and diffing `title`/`thead`/`perPage`/`cols`.
    The tidy split was the right instinct and the wrong outcome: one definition
    the view can actually reach beats a separation that leaves the view with
    nothing.

    Three things worth carrying, and the last is the important one:

    - **The card suite asserted SHAPE, not CONTENT.** It checked two pages, the
      section order, the row capacities, and the PDF page count — and **every
      one of those passes just as well over an unlabelled table**. It is easy to
      write a thorough-looking suite that never asks whether the words are
      there.
    - **Restoring the headings could have cost a sheet of paper.** They add
      height to a layout tuned in millimetres, so T3's page count (2 / 4 / 6)
      was the assertion that mattered most after the fix, not the text checks.
    - **The real printout gate passed over this defect.** A Kad Rekod was
      printed from V2 on the real printer and accepted (§8) — with no headings
      on it. Three print defects have been found on paper and none by any other
      means, so the printout stays mandatory; but **a printout only catches what
      the person holding it is looking for.** Necessary, never sufficient. When
      asking someone to check a printout, say what to look at.

21. **Four more features were simply absent, and a two-minute grep found them
    all.** Reported 2026-08-09 by an officer: tapping a pin jumped straight to
    the Kad Rekod. V1 opens a **detail modal** first — coordinates, **🧭
    Directions**, 🗺️ View, Last Inspected, and a *Kad Rekod* button. Directions
    is how an officer navigates to a pili while standing in a field, and it
    existed nowhere else in V2.

    Rather than patch that one, V2's whole surface was diffed against V1's for
    the first time. Three more gaps fell out:

    - **The mobile registry sheet.** Worse than missing: `map.css` parks
      `.cards .card` at `translateY(calc(100% - 52px))` on a phone and only
      `.cards.mob-open` brings it back. With no handle and no summary rendered,
      the registry was a **52px sliver with no way to open it** — on the device
      this app is actually used on. Only the media-query overrides had been
      ported; the base `.mob-handle` / `.mob-reg-summary` rules were absent too.
    - **"Pemeriksaan terkini" was an empty table.** `DashView` rendered
      `<tbody id="dashRecent"><slot name="recent" /></tbody>` and **nothing
      filled that slot** — not the app, not the harness.
    - **The donut's hover dimming** (`d-dim`) and its keyboard activation. The
      segments carry `tabindex` and `role="button"`, so Enter and Space were
      buttons that could not be pressed.
    - **`storeWarn`.** V1 warns when localStorage is blocked; without it the
      failure is silent, and localStorage is what every offline guarantee in
      §4.10 rests on.

    **The signature they share:** V2's stylesheets were ported from V1
    *wholesale* while the markup was not, so the app looked fully styled and
    finished and nothing errored. Two mechanical greps find that whole family —
    classes V2 styles but never renders, and element ids V1 has that V2 lacks —
    and both are now `tests/v2-parity-surface.js`, run on every push.

    Three things worth carrying:

    - **The greps took under a minute and were never run.** Seven handovers,
      seven defects found by a person. Each fix was verified against *itself*;
      the migration's thesis is "changes nothing an officer sees", so the only
      check that mattered was V2-against-V1 and it was never made.
    - **The guard's first version was useless and a mutation proved it.**
      It grepped `v2/src`, so deleting `<HydrantDetail>` from the template left
      it green — `HydrantDetail.vue` still sat on disk. It now reads the **built
      bundle**, where an unimported component is tree-shaken away. Same lesson
      as §5's CSP probe: *check the artefact*.
    - **A test can encode the bug.** `v2-app-live` T7 asserted that tapping a
      pin opens the card — which was the parity gap, written down as a
      requirement. When behaviour is restored to V1, the tests that codified the
      drift have to be corrected too, not worked around.

22. **The Print button had never worked, in any V2 build.** Reported
    2026-08-09. Pressing it did nothing; the console said
    `TypeError: t.setTimeout is not a function`.

    The handler was an inline template expression:
    `@click="() => { refreshPrintSigs(); setTimeout(() => window.print(), 60); }"`.
    **Vue compiles template expressions against the component context**, so a
    bare `setTimeout` resolves to `_ctx.setTimeout` — which does not exist. It
    reads as ordinary JavaScript and is not: inside a template, globals are not
    in scope. Moved to a `doPrint()` function in `<script setup>`, where
    `setTimeout` is just `setTimeout`.

    **A global in a template expression is the smell.** It was the only one in
    the app; a grep for `setTimeout|setInterval|window.` inside `@click`/`:prop`
    bindings finds them.

23. **Saving a Kad Rekod never reached the `hydrants` table.** Reported in the
    same message as "date last inspected not showing on hydrant".

    V1's `saveForm` calls `syncLocation` **and** `syncLastInspected`, and each
    ends in `cloudSave()`, which upserts the hydrant row. V2 set
    `hy.lastInspected` in memory and called `hydrants.persist()` — **localStorage
    only**. Nothing in V2 ever upserted `hydrants`: the only writes were the
    paged `select` and the `insert` behind Tambah Pili.

    Two consequences, one reported and one not yet:

    - **Last Inspected never left the device.** And it looked fine where it was
      typed, because `mapRows` falls back to `known[r.id]` and preserves the
      local value across a pull — so it is correct on the device that wrote it
      and blank on every other one, and blank after any cache clear. **A
      same-device test passes straight over this**, which is why T13 asserts the
      upsert rather than the pin.
    - **The card's Lokasi was written nowhere at all**, silently breaking the §3
      rule that the Kad Rekod is the address of record and the popup, registry,
      search and dashboard links all follow it.

    The two rules are **asymmetric on purpose** and both are ported verbatim: a
    blank Lokasi never overwrites (clearing the field must not wipe a registered
    address), while a blank date **does** clear the badge (§3: returning early
    left the map advertising an inspection the record no longer held).

    Worth carrying: **`tests/v2-parity-surface.js` was green through all of
    this, correctly.** It checks that classes and ids exist in the bundle, and
    its own header says it catches *absence, not wrongness*. The Print button
    existed. The Save button existed. Both were wired to nothing useful. A
    structural guard cannot answer "does pressing this do anything", and it was
    treated as though it could.

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
- **Wrote a fourth test that was blind at exactly the boundary it guarded.**
  V2's search suite asserted that a search re-fits the map. Deleting the
  `fittedKey` reset it existed to protect left it entirely green — every
  *narrowing* search changes the visible set, so the map fits for an unrelated
  reason. The reset only matters when the matches are the set already fitted.
  Same shape as the donut band, the §4.14 flush path, the grey-vs-dark
  signature metric and the clean signature fixture: **a fixture that cannot
  reproduce the defect proves nothing, however many assertions it carries.**
  Mutate the code and watch the test go red, every time, before trusting it.
- **Declared six phases complete while two whole features were broken.** The
  dashboard read all zeros (`inspStatusOf` was still a `() => 'none'` stub and
  the index was `{}`), and **tapping any pin crashed the app** —
  `records.load()` returns a form and never assigns `this.form`, so `openCard`
  read `records.form.header` and threw. Neither was a logic bug: both were
  **the join**, the code between the stores and the components. Nothing covered
  it, because the component suites mount through the harness with fixtures
  already supplied and the store suites call the stores directly — and between
  those two is where the app lives. Third time this shape has appeared (the CSP
  probe standing in for an app; `MapShell`'s duplicate pills). **A phase gate
  proves a layer; an app is the seams between layers.** `tests/v2-app-live.js`
  now drives the assembled app, and found a third defect on its first run.
- **Relied on an in-memory flag to protect a permanent record.** V2's
  `deadRows` refused to delete a row carrying `_signed`, which is what V1 does
  and is sufficient *there* — V1 always writes into the existing row object, so
  the flag survives. V2 can **replace** a row with a fresh blank one, and a
  blank row carries no `_signed`. An admin clearing a signed row produced a
  DELETE for it. The trigger would have refused it, but **a client that has to
  be caught by the trigger will eventually find a path around it.** Permanence
  is now also read from the server's own `signed` column, snapshotted at open.
  The wider point: when a rule is enforced in several layers, the client's copy
  of it must not depend on state a UI action can quietly drop.
- **Moved the record card into a component and it stopped printing.** V1's
  print rule is `body.form-open > *:not(#formOverlay){display:none!important}`.
  In V2 the card renders inside `#app`, so `#app` matched that rule and the
  **entire card was `display:none` on paper** — one blank sheet. Nothing on
  screen changed and nothing in the PDF looked wrong; the card simply was not
  in it. Found only by counting pages in a rendered PDF. Fixed by teleporting
  the overlay to `<body>` so it sits where V1 puts it. **When the print CSS and
  a new component structure disagree, the component moves** — the CSS is the
  part that has been proven on paper.
- **Cut a CSS rule in half and lost a whole stylesheet, silently.** Copying
  V1's mobile block into `map.css` I sliced through `.cards .card`, leaving the
  file one `}` short. **An unbalanced stylesheet does not fail and does not
  warn** — the parser NESTS everything after the unclosed block inside it, so
  those rules just stop applying. Because `main.js` imports `dashboard.css`
  after `map.css`, the entire dashboard lost its styling while the build stayed
  green and the app still rendered. Two things worth carrying: **transcribe
  whole rules, never line ranges**, and counting braces in the *sources* is not
  a check — `{` and `}` appear inside comments and `@keyframes` prose, which
  gives false answers in both directions. The built file is what the browser
  parses, and `tests/v2-dashboard-css.js` now checks its balance there.
- **Recommended a deploy off an app that did not exist.** I described V2 as
  "done minus login and the record card" and proposed a staging deploy on that
  basis. `v2/src/App.vue` was still the **CSP probe** written as scaffolding in
  Phase 0 — the production bundle had contained no application for three
  phases, while every component suite ran green, because they all mount
  components through the test harness rather than through the app. One command
  against the built bundle would have shown it, and I ran that command only
  after recommending the deploy. **A green suite says the parts work, never
  that the whole exists** — and "I know what this builds" is a claim about an
  artefact, so check the artefact.
- **Recommended work I could not finish.** I proposed creating a scratch
  Supabase project for a restore test "then deleting it" without first checking
  that I had a way to delete it, or a token to download the backup artifact. I
  had neither. Check the whole path is available before recommending it.
- **Put a performance optimisation inside a generator whose output is a
  contract.** Restoring V1's 2°→6° arc coarsening, I derived the resolution
  from `sweep` **inside `buildDonut`** — so every frame with `sweep < 1` was
  drawn at a different resolution from V1. `tests/v2-donut-parity.js` compares
  intermediate frames byte-for-byte and went from 29 passing to **325 failing**
  in one edit. V1 puts the decision in `dAnimate`, its *caller*, and that is not
  a stylistic detail: `buildDonut`'s output is the thing under parity, so
  anything that changes its bytes belongs outside it. Moved to `Donut.vue`,
  where V1 has it. The suite did its job — but the reasoning should not have
  needed it.
- **Told the user "a retry is fine here".** Having already established, and
  written into `docs/STAGING.md`, that **a Cloudflare retry replays the same
  commit by design**, I then advised retrying a deployment to pick up a new
  commit. It rebuilt the old one and failed identically. Advice that
  contradicts something already diagnosed in the same session is worse than no
  advice, because it spends someone else's time re-finding it.
- **Built a guard, then treated it as covering more than it does.** I wrote
  "catches ABSENCE, not WRONGNESS" into `v2-parity-surface.js`'s own header —
  and then handed V2 over as if the parity question were closed. The next three
  defects (§4.22, §4.23) were all wrongness: the control renders, the guard is
  green, the wiring behind it is dead. **A guard's stated limits are a list of
  what still has to be checked by other means**, not a disclaimer to be written
  once and forgotten.
- **Handed V2 back seven times without once comparing it to V1.** Every fix was
  verified against itself — the change I made, tested by the test I wrote for
  it. The migration's whole thesis is "changes nothing an officer sees", so the
  question was never "does my change work" but "does V2 do what V1 does", and I
  did not ask it until told to. Two greps then found four missing features in
  under a minute (§4.21). The cost landed on the user, who found six defects by
  using the app. **When the goal is parity, the baseline is the test.**
- **Named a Pages project after a repo that already existed.** I suggested
  calling it `epilibomba-v2`; a GitHub repo of that name exists holding a
  stripped copy of `v2/` — the decoy `docs/STAGING.md` §1 explicitly warns
  against — and the project got pointed at it. Check a suggested name is not
  also the name of something selectable in the same dialog.

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
- **From the audit — nothing left that is free to fix.** **Leaked-password
  protection is off and stays off: the Supabase org is on the `free` plan and
  the feature is Pro-and-above.** It sat on this list for weeks described as a
  dashboard toggle; it was never actionable. It is a spending decision, like
  backup retention — not a task. Also accepted: 7 of 8 accounts are admin, the
  user chose to keep the roles and add the audit trail instead.
  **Closed:** the unbounded hydrant read is paged (`cloudLoad`; `cloudFormLoad`
  was never at risk, it filters by `hydrant_id`), and the `SECURITY DEFINER`
  RPC endpoints are shut — `sql/supabase-hardening.sql` run on production and
  **verified 2026-08-06 by an admin saving a Kad Rekod row from the app.**
  That save is the check that counts: it proves the write reached the database
  through RLS, so the policy called `is_admin()` and it evaluated. The script's
  own verification query passes even when every write is blocked, which is how
  the first version of this change nearly took the app down — see §5.
  **`authenticated` must keep `EXECUTE` on `is_admin()`.**
- **`sql/` had drifted from production again — found 2026-08-07** by running
  Supabase's own security advisor, a check nobody had ever run. Three things:
  `lock_signed_records()` and `trg_lock_signed` existed on production and
  **nowhere in this repo**; `protect_signed_rows()` was `SECURITY DEFINER` with
  a pinned `search_path` live but neither in the script; and the hardening
  claimed to close "both" `SECURITY DEFINER` helpers when there are five
  functions in `public`, three of which it never touched. None was exploitable
  — all three return `trigger`, so PostgREST cannot invoke them. All backported,
  and the revokes added to the base scripts too so a recovery that skips the
  optional 5th cannot reopen them. **Run `get_advisors` after any schema
  change; it is free and it found what a year of reading the scripts did not.**
  Applied and **verified on production 2026-08-07**: `anon` closed on all five,
  `authenticated` retained on `is_admin()` alone, `stamp_row_audit`'s
  `search_path` back to two elements, and an officer save confirmed from the
  app. The advisor is down to two notices — `is_admin`/`authenticated`, which is
  correct and must never be "fixed", and leaked-password, which needs a paid
  plan. A fourth lesson from this: the fix shipped in script 4 while the
  hardening people re-run is script 5, so it silently did not get applied.
  **A script must be able to deliver every fix it tells you it delivers**, and
  its verification query must select the column it is verifying — the old one
  did not print `search_path`, so it reported success on a broken pin.
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
- **V2 staging is live on Cloudflare Pages** — `epilibomba-staging.pages.dev`,
  built by Cloudflare straight from `claude/epb-v2`. See `docs/STAGING.md`.
  **Two things about it are accepted trades, not oversights.** It points at the
  **production Supabase project**, so every save made on staging is a real save
  against the real register — that is what makes it worth testing on. And the
  test suites do **not** gate the deploy: Cloudflare ships every push, green or
  red. `scripts/verify-bundle.js` runs in the build command and fails the
  deployment on a bad *artefact* (harness page, CDN origin, missing `_headers`,
  `unsafe-inline`), so a malformed bundle cannot reach staging — but a logic
  regression can. If `tests.yml` is red, assume staging is carrying it.
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

**Confirmed on V2 staging (2026-08-09)** — the first deployment carrying the
real app, after staging spent days serving a commit six behind (docs/STAGING.md
§1 step 5c). Sign-in, the map rendering as a continuous tile grid, the
dashboard, and **the Kad Rekod opening and working** — all on the assembled V2
bundle against the production database.

**And confirmed ON PAPER from V2 (2026-08-09)** — the Kad Rekod printed from
the V2 bundle on the real printer, and it works. This was the last mandatory
gate in `docs/KAD-REKOD.md` and the one most likely to fail: every print-facing
property of this card is invisible until it reaches paper (three print defects,
three found on paper, none found by any other means), and V2 *moved the card
into a component*, which already broke printing once — the `#formOverlay`
teleport, which produced a single blank sheet while nothing on screen changed.

Note what the staging run alone would have proved: nothing about paper. The
card "opening and working" is a screen claim. Keep printing one after any change
that touches the card, the print CSS, or the component structure around it.

**⚠ That printout did NOT carry the section titles or the column headings** —
§4.20 was found afterwards, and the card that was printed and accepted had four
blank yellow bars and unlabelled columns. So the run above proves the *page
geometry* (two sheets, the section order, the row heights) and **not** that the
card is complete. **A fresh printout is required, checked specifically for the
four section titles and every column heading.** The lesson is in §4.20: a
printout only catches what the person holding it is looking for, so say what to
look at when asking for one.

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

**Confirmed on paper (2026-08-08)** — the printed Kad Rekod signature now reads
solid black against the table rules, on a real printer. This closes the defect
found on the first real printout: the ink was measured at darkest luminance 137
with **not one pixel below 128**, looked perfectly fine on a backlit screen, and
came out visibly faded.

Worth keeping the shape of this in mind: the fix was measured (darkest 134 → 0,
and 0 → 2,972 pixels below mid-grey) and guarded by
`tests/kad-rekod.js` T7, but **the measurement was never the proof**. Neither
was the screen. Every print-facing property of this card is invisible until it
reaches paper, which is why `docs/KAD-REKOD.md` requires a real printout before
anything touching the card ships.

**And confirmed again on paper (2026-08-08, second printout)** — the black box
that fix caused (§4.15) is gone, and the signature is present and legible. That
second check mattered as much as the first: the replacement had to be verified
not only for "is the ink black" but for "is the signature still *there*", since
a threshold slightly too high erases faint strokes entirely.

**Three print defects, three found on paper, none found by any other means.**
Faded ink, then a black box, then the risk of an erased signature. The screen
was wrong every time, the automated measurements were necessary but never
sufficient, and each one was caught by an officer printing a card. Treat the
printout as the gate it is.

**Committed regression tests** (`tests/`, see `tests/README.md`):
- `csp-and-vendor.js` — 21 assertions: no CDN tag or CDN origin left anywhere,
  every vendor file present, and the app booted under the **real CSP read from
  `_headers`** with the real Leaflet — pins rendered on the map, the
  markercluster plugin and the zoom control present, Supabase client loaded,
  zero CSP violations, zero page errors. (It asserts pins **exist**, not how
  many: a suite tied to a hydrant count would go red every time an officer adds
  a pili, which is a passing build reporting a failure.)
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
