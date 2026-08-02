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
| `_headers` | CSP / HSTS / Permissions-Policy. `geolocation=(self)` is required by "Guna Lokasi Saya" |
| `sql/supabase-setup.sql` | **1st** — profiles, `is_admin()`, hydrants (187 seeded) |
| `sql/supabase-records-setup.sql` | **2nd** — hydrant_records, signatures bucket, permanent row lock |
| `sql/supabase-jadual-setup.sql` | **3rd, optional** — shared inspection schedule |
| `drafts/dashboard-draft-glass.html` | Standalone dashboard design draft (superseded by the real thing, kept for reference) |
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
| Chart palette | Cream `#FDF0D5` / steel `#669BBC` / navy `#003049` | User-supplied. Ordered lightest = most complete |
| Navy as text | **Never** — substitute `#9CAAB6` | Navy is 1.42:1 on dark, unreadable. Fill-only colour |
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

## 5. Things I got wrong (so they aren't repeated)

- **Overstated a CSS collision risk.** I claimed `table/th/td` was "especially"
  risky because the record card uses tables. Wrong — every record-card table is
  `.ftab th/.ftab td`, and class specificity (0,1,1) beats a bare element
  selector (0,0,1). The **genuine** collisions were `.card` (registry card),
  `.btn` (modal buttons) and `.pill` (Awam/Swasta). Scoping under `#dashView`
  was still right, but it was routine hygiene, not a near-miss.
- **Asserted before checking.** The lesson that keeps paying: measure in a real
  browser, don't reason from the screenshot.

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
- **Jadual over 1000 rows in one period** — the query is filtered to the
  selected period and capped at 1000. Far beyond realistic volume for six
  months, and if it ever hits the cap the header says so rather than
  undercounting quietly. Paginate if it becomes real.

---

## 8. Verified vs not

**Verified in a real browser** (Playwright, Chromium):
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
