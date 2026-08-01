# e-Pili Bomba Kunak — working memory

Rolling record of what this project is, what was decided and why, what was
built, and what is still open. Written so a cold start can pick up without
re-reading the whole conversation.

Last updated: 2026-08-02 · branch `claude/epilibomba-build-compile-3hhuqp`

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
| Past schedule rows | Kept, listed below upcoming, marked `lepas` | Nothing silently disappears |
| Dashboard scope | Follows the Awam/Swasta pills, incl. cleared = Semua | Must match the map exactly |
| Mobile header | Hamburger menu for account actions; tabs left-aligned with pills | User sketch |
| Mobile kicker | **Hidden** on phones | ~200px wide, forced an extra header row. Bought back 41px of map. **Not asked for — offer to restore** |
| Zoom buttons | 34px on mobile | User asked. **Below the 44px touch minimum — flagged** |

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

- **Archive on period reset** — when a period rolls over, should archives keep
  the full hydrant list or just totals? Asked, never answered. Currently periods
  are computed from dates, so nothing is archived or lost.
- **Kicker on mobile** — hidden without being asked. Offer to restore.
- **Zoom at 34px** — below the 44px touch minimum. Offered 38–40px compromise.
- **Jadual row cap** — the schedule query isn't paginated. Fine for years at
  station volume, but it is the same class of bug as #1 above if it ever grows.

---

## 8. Verified vs not

**Verified in a real browser** (Playwright, Chromium):
- Dashboard figures from real Pengujian data, all scope states (Semua/Awam/
  Swasta) reconciling to their totals
- Pagination against 2400 rows over 160 hydrants — 3 requests, exact counts
- Both routes to the map (status filter, Lokasi search)
- Jadual in all three states: no cloud, cloud-but-table-missing, cloud working
- Mobile at 360/390/430px — no horizontal overflow, alignment measured
- Account menu opens/closes, and its items work despite standing in for
  `display:none` buttons
- z-index regression: modal, login gate, header/search boundary
- Animation cost under CPU throttling

**Not verified — the sandbox blocks CDNs and Supabase:**
- The real Supabase connection. `scanCloud` and the jadual queries have only run
  against a stand-in client. Logic and payloads are right; the round-trip isn't
  proven.
- Anything rendered **on** the Leaflet map: the zoom-button size against the real
  control, the banner over real tiles, and `map.invalidateSize()` when returning
  from Dashboard to Peta Pili.

**First things to check on the live site:**
1. Dashboard header says **"Data awan ✓"**, not "peranti ini"
2. Dashboard → Peta Pili — map fills the pane, not a grey sliver
3. Tap Awam — banner appears under the search bar, one line, chip-sized
4. Zoom buttons look right at 34px
5. If the jadual SQL was run: add a row, confirm it appears on a second device

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
