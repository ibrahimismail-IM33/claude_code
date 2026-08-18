# e-Pili Bomba Kunak — Product Requirements Document

| | |
|---|---|
| **Product** | e-Pili Bomba Kunak |
| **Owner** | Ibrahim Ismail, BBP Kunak (JBPM Sabah) |
| **Status** | Live in production at epilibomba.com |
| **Scope today** | One district — BBP Kunak |
| **Document date** | 2026-08-04 |

This document states what the product is, what it does, what is wrong with it,
and what should happen next. Section 8 records organisational risks that are
not software problems. They are included because they are the risks most likely
to end this project, and leaving them out of a PRD would be dishonest.

Companion: `FULL-ARCHITECTURE.md` for how it is built.

---

## 1. The problem

BBP Kunak maintains a **Kad Rekod Pili Bomba** for every fire hydrant in the
district — a paper record of inspections, faults, testing and compounds.

Paper has three failures that matter operationally:

1. **Locating a hydrant** requires local knowledge. A new officer, or an
   officer covering an unfamiliar zone, cannot find a hydrant from a card.
2. **The record lives in one building.** An officer in the field cannot check
   whether a hydrant was inspected, or what was found last time.
3. **Nothing aggregates.** "How many hydrants are outstanding this half?"
   requires reading every card by hand, so in practice it is not asked.

A fourth failure is worse and less visible: **a paper record has one copy.**
Water, fire and misfiling are all real, and the record of an inspection is the
evidence that the inspection happened.

## 2. Users

| User | Count | Needs |
|---|---|---|
| **Field officer** | ~8 at BBP Kunak | Find a hydrant on a map, open its card, record what was found, sign it — on a phone, outdoors, sometimes in gloves, sometimes with poor signal |
| **Station admin** | Currently 7 of the 8 | Everything above, plus add and edit hydrants and maintain the schedule |
| **Viewer** | Default for new accounts | Read-only |

**Primary device is a phone in the field.** Every design tension resolves in
favour of that: large targets, no zoom-on-focus, no sideways scroll, high
contrast in sunlight, and the app must remain useful with no signal at all.

Interface language is **Bahasa Malaysia**.

## 3. What it does today

### 3.1 Map (Peta Pili)
- Every hydrant in the register on OpenStreetMap, clustered.
- Pin colour by ownership: **Awam** (`kerajaan`) / **Swasta**.
- Amber `!` badge on any pin with unsent offline work.
- Filter pills, place-name search, "Guna Lokasi Saya" (needs
  `geolocation=(self)` in `_headers`).
- Tapping a pin opens the hydrant popup, which links to the Kad Rekod.

### 3.2 Kad Rekod Pili Bomba
- Four sections: **Kerosakan, Pemantauan, Pengujian, Kompaun**, plus a header
  block (Lokasi, Tarikh Pasang, No. Keahlian, Tarikh Daftar).
- Paginated card pages matching the paper form; printable.
- **Signing** captures a signature on canvas, strips the paper background,
  uploads it, and stamps `signed_by` / `signed_at`.
- **A signed row is permanent.** Enforced twice, independently — by RLS policy
  and by a database trigger. Signature images can never be replaced or deleted.
- **An unsigned row can be withdrawn.** Clearing it and saving removes it from
  the record — admin only, works offline, and the row keeps its place on the
  card as an empty row. An inspection recorded against the wrong hydrant has to
  be correctable; a signed one never is.
- **The card is master for Lokasi.** Saving writes `hydrant.location`, and the
  popup, registry, search and dashboard all follow. A blank field never
  overwrites, so clearing it cannot wipe a registered address.

### 3.3 Dashboard
- **Derives every figure** from the Pengujian rows the card already writes.
  Nothing is stored separately, so nothing can drift:

  | Figure | Definition |
  |---|---|
  | Diperiksa | Pengujian row in the period, signed |
  | Belum di-sign | Row in the period, not yet signed |
  | Belum diperiksa | No Pengujian row in the period |

- Rolling **6-month half** period, current plus three archived.
- 3D donut with real projected geometry, animated on tab entry.
- Everything is clickable — labels and status rows filter the map.
- Scope follows the Awam/Swasta pills exactly, including cleared = Semua.

### 3.4 Jadual Pemeriksaan
- Shared inspection schedule: **Tarikh, Pasukan, Lokasi**.
- Sorted **latest date first**; past dates tagged `lepas`.
- Admin-only add / edit / delete, with confirmation on delete.
- One folder per period, decided by the row's own date, so rollover needs no
  migration.
- **No "done" tick** — the signed Pengujian row already proves the visit
  happened, and a second flag would drift from it.

### 3.5 Offline behaviour
- localStorage is the **primary read source**; the app opens instantly and
  works with no network.
- A save that fails is **parked**, not lost, and pushed automatically on
  reconnect.
- A row nobody else touched syncs silently. A genuinely contested row is held
  back, cloud wins, and the officer is warned and shown what they typed.
- Unsent work is visible on the card **and** on the map pin, so an officer
  never has to open every hydrant to find what has not synced.

### 3.6 Accounts
- Email + password. Any signed-in user reads; only `admin` writes.
- New accounts default to `viewer`; promotion is a manual SQL statement.
- **Every officer must have their own login** — signatures record who signed,
  which is meaningless on a shared account.

## 4. Non-functional requirements

### 4.1 Performance — measured, not estimated
Dashboard entry animation, profiled under CPU throttling. 60 fps budget is
16.7 ms/frame.

| CPU | Frames | Total main-thread | Avg | Worst | Dropped |
|---|---|---|---|---|---|
| Normal | 53 | 57 ms | 1.1 ms | 4.5 ms | **0** |
| 4× slower | 38 | 194 ms | 5.1 ms | 11.1 ms | **0** |
| 8× slower | 25 | 225 ms | 9.0 ms | 15.9 ms | **0** |

Zero ongoing cost — 0 rAF callbacks in the 2 s after it settles. The animation
fires only when the Dashboard tab is opened, never during map init, so it
cannot compete with the markers loading.

### 4.2 Network discipline
Background pulls throttled to one per 10 s; nothing runs while the tab is
hidden. A pull **never re-fits the map**, so it cannot jump the view away from
what an officer is reading.

### 4.3 Accessibility and legibility
- Figure ink measured against the real card background: green 10.6:1,
  blue 7.3:1, red 6.7:1 — all above 4.5:1.
- Navy `#003049` is **never** used as text (1.42:1); `#9CAAB6` substitutes.
- Zoom buttons are 34 px on mobile — below the 44 px touch minimum, accepted
  after the user confirmed it works in the field.

### 4.4 Layout
No horizontal overflow at 360 / 390 / 430 px. Wide tables scroll inside their
own container.

### 4.5 Security posture
No external origin may execute code. All libraries are self-hosted, so
`script-src` is `'self'`. Every access rule lives in RLS or a trigger, never in
the client.

## 5. Current state

Live counts are deliberately **not** written down here. They change every time
an officer adds a hydrant or signs a card, and a number copied into a document
goes stale without anyone noticing — this section already claimed 187 hydrants
on the day the register held 188. A confidently wrong figure is worse than no
figure, so this points at the source of truth instead.

| What | Where to read it |
|---|---|
| Hydrants, and the Awam / Swasta split | The pills in the app header, or `select status, count(*) from public.hydrants group by status;` |
| Records, and how many are signed | `select count(*) filter (where signed) as signed, count(*) from public.hydrant_records;` |
| Signature images | Supabase → Storage → `signatures` |
| Accounts and roles | `select role, count(*) from public.profiles group by role;` |

Fixed facts, which do not drift:

| | |
|---|---|
| Districts | 1 — BBP Kunak |
| Codebase | `index.html`, one file, no build step |
| Tests | 5 suites — run by CI on every push, publishing blocked on them |
| Backups | Nightly, verified weekly by automated restore |

The seed in `sql/supabase-setup.sql` inserts **187** hydrants (170 Awam,
17 Swasta). That is a fact about the file and stays true; it is not a claim
about what the register holds today.

## 6. Open issues

### P1 — none outstanding

*Both closed 2026-08-04.* `sql/` was brought back in step with production, and
the test suites now run in CI on every push with publishing blocked on them
(`tests.yml` + `needs: test`). See §9 Phase 1.

### P2 — Hardening. Real, but nothing is on fire

**6.1 Leaked-password protection is off — and cannot be turned on.** The
Supabase org is on the **`free` plan**; the HaveIBeenPwned check is a
Pro-and-above feature. This was carried for weeks as "one switch in the
dashboard", which was wrong — the switch is not there. It belongs with 6.3 as a
spending decision, not a task.

**6.2 Seven of eight accounts are admin.** Accepted deliberately, with the
audit trail added instead. Revisit if headcount grows.

### P3 — Needs a decision, not just code

**6.3 Backup retention is 90 days** in GitHub artifacts, which vanish with the
account they are protecting. A second location costs money and needs a decision
about where.

### Test coverage gaps
Dashboard figures and donut geometry, the jadual round trip against a real
table, the login gate and roles, record-card validation, map filters and
search. All verified by hand; none guarded by a committed test.

## 7. District expansion

The obvious next step is other JBPM districts in Sabah. This section records
the analysis so the decision is made with the cost visible.

### 7.1 Do not fork the app per district

This is the one option to rule out. The project has already lived through the
failure: `claude_code` and `e-pili-bomba` drifted **7 commits apart** and
officers used a live app missing fixes. That was two copies of one app.

Five copies means fixing every bug five times, remembering to, and getting it
right five times. Within a year they are five different applications and nobody
can say which district runs which.

**One codebase. Many districts inside it. Always.**

#### Nor per-district files or folders

Raised 2026-08-08 as *"the hydrant file is `../kunak(district)/hydrant list`"* —
separate each district's data. **The goal is right and it is problem #1 below.
The shape is not**, and the intermediate idea deserves ruling out explicitly
because it is the form the thought naturally takes and it sits one small step
from the per-district deployments above.

Three reasons:

1. **"The hydrant list" is not a file.** The source of truth is the `hydrants`
   table in Supabase; `cloudLoad()` pages it and replaces local state. The
   189-line `INITIAL_HYDRANTS` array in `index.html` is a **seed/fallback** for a
   device that has never reached the cloud — `loadHydrants()` returns
   localStorage first and that array last. Reorganising it into district folders
   would tidy the least important of the three copies.
2. **A folder fixes none of the five problems in §7.2.** Labels still collide,
   writes are still global, and a database cannot filter on a directory. The
   separation has to exist where the data does.
3. **It invites the failure §7.1 exists to prevent.** Per-district files are one
   refactor away from per-district deploys, and this project has already paid
   that bill once.

What *is* worth doing, **after** the `district` column exists: lift the seed data
out of `index.html` into per-district data files. That is what makes §7.3's
promise true — a new district becomes a data-entry job. Before the column it
buys nothing, and doing it first would feel like progress while delivering none.

### 7.2 What actually breaks

| # | Problem | Detail |
|---|---|---|
| 1 | **No `district` column** | Not on hydrants, records or jadual. Today everything *is* Kunak; the day it is not, every row is ambiguous |
| 2 | **Label collision** | `A01`–`E**` are zoned to Kunak. Another district will also want `A01` |
| 3 | **Global write access** | `is_admin()` grants write everywhere. A Lahad Datu officer could edit Kunak's records |
| 4 | ~~**The 1,000-row wall**~~ **— CLOSED** | Was: ~5 districts crosses it, rows stop arriving, nothing errors. Now paged or bounded everywhere it mattered — see below |
| 5 | **Wasted load** | Without the column the database cannot filter, so every phone downloads every district |

On (4), closed 2026-08-08 — recorded because a document that overstates what is
broken drives bad decisions just as surely as one that hides breakage:

| Read | State |
|---|---|
| `cloudLoad` (the register) | Paged — `LOAD_PAGE=1000, LOAD_MAX=50`, ordered by `id` so `range()` cannot repeat or skip |
| Dashboard Pengujian scan | Paged — `SCAN_PAGE=1000, SCAN_MAX=50`, ordered by `hydrant_id, row_index` |
| `cloudFormLoad` (one card) | Never at risk — filtered by `hydrant_id`, so it reads one card's rows |
| Jadual | **Capped, not paged** — 1000 per period, and the header *says so* rather than undercounting silently. Far beyond realistic six-month volume; paginate if it ever becomes real |

All four are carried into V2 with parity suites that compare the ported logic
against V1's real source. **The rule that remains: any new query gets `.range()`
from the start.** PostgREST truncates at 1000 and reports no error, so an
unbounded read does not fail — it lies.

On (5): a Kunak officer still inspects the same set of hydrants no matter how many
districts exist. Without a `district` column their phone would download ~1,870
at ten districts and discard 90%. **The column is what keeps each officer's
load flat** — Kunak-sized whether there are 2 districts or 30. Caching does not
help here: it makes a correct answer cheaper, but it cannot make a truncated
answer correct.

### 7.3 The change — DONE (foundation landed 2026-08-15)

**Status: the district-ready foundation is implemented.** Owner's call this
session: build the foundation now as insurance, without onboarding any second
district (the "foundation only" ambition). What shipped:

- **DB** (`sql/`): `district text not null default 'KUNAK'` on `hydrants`,
  `hydrant_records`, `jadual_pemeriksaan` and `profiles`; a new
  `public.can_write(target)` (SECURITY DEFINER, pinned search_path) that returns
  `is_admin() AND caller's profile.district = target`; the three write policies
  on each table repointed from `is_admin()` to `can_write(district)` — **reads
  stay global for mutual aid**, only writes are scoped; the signed-row guard is
  preserved exactly; `hardening` closes `can_write`'s RPC endpoint to anon while
  `authenticated` keeps EXECUTE; labels unique per `(district,label)`, added
  guarded (skipped-with-notice if a dup already exists).
- **App** (V2): the officer's home district comes from `profiles.district`
  (`auth.js`, default KUNAK, fails closed); every query is filtered by it
  (`cloudLoad`, jadual `load`, dashboard scan) and every write stamps it
  (Tambah Pili, record save/flush/signRow, jadual add). **No visible selector
  yet** — a one-option selector is noise; it arrives with district #2. V1 is
  untouched (frozen rollback), and rollback stays safe *while single-district*.
- **Tests**: `tests/v2-record-sync.js` T9 proves an officer is refused writing
  another district and succeeds in their own (stub models `can_write`, §4.29),
  mutation-checked red; T10 pins the read-scope + schedule stamp.

The rest of §7.3 below is the original design note, kept for the record.

### 7.3 (original) The change, when it is wanted

**Database** — add `district` to `hydrants`, `hydrant_records` and
`jadual_pemeriksaan` (default `'KUNAK'`) and to `profiles`; extend `is_admin()`
into `can_write(target_district)` so writes are scoped to the officer's own
station while reads stay global for mutual aid; make labels unique per
`(district, label)`.

**App** — one district selector defaulting to the officer's own; every query
filtered by it. Paging is **already done** (§7.2 item 4) — `cloudLoad` and the
dashboard scan both page, and `cloudFormLoad` is bounded by `hydrant_id`. Keep
`.range()` on anything new, and note that the district filter *reduces* each
phone's load rather than adding to it.

**Tests** — extend `p0-offline-sync.js` with a cross-district permission case:
an officer of district A must be rejected writing district B. Confirm it fails
on the pre-change code.

**Cost: about two days, once.** After that each new district is a data-entry
job, not an engineering project. Forking is cheaper the first time and costs
forever afterwards.

**Expected file growth: 300–500 lines, about 15%.** District logic is a filter,
and filters are cheap. Split the file by *feature* at ~6,000 lines or when a
second developer joins — never by district.

### 7.4 Full multi-district activation — FUTURE (do when district #2 arrives)

Owner's decisions, 2026-08-15. **Not built — recorded so it is ready.** The
trigger is deliberate: **build this when a second district actually onboards,
not before.** A one-option selector and untested role paths shipped ahead of
need are cost without value (§7.3 is why the visible selector was deferred).

**What is already done** (§7.3, live): the `district` column, `can_write()`
scoping every write to the officer's own district, and every read/scan/insert
filtered and stamped. So "only own-district admin edits own district" — the
owner's point #3 — **already holds.** What remains is the role tier, the
provisioning panel, and the selector.

**1. Role model — three tiers.** `viewer` < `admin` < **`upper_admin`** (a
*district manager*). One or more `upper_admin` **per district**, who may
create/promote the `admin`s and `viewer`s of **their own district only**. No
cross-district authority. The `role` check constraint on `profiles` grows to
`('viewer','admin','upper_admin')`.

**2. Provisioning — an in-app admin panel.** A user-management screen (list
accounts, set role, set district) so a district manager provisions their own
people without touching Supabase. **This is the hard, security-critical part,
and the crux is a hole that is latent today:** `admins manage profiles` is
currently `for all ... using (is_admin())`, so **any admin can edit any
profile's `role` AND `district`.** Harmless while single-district; the day there
are two it is **privilege escalation** — a Kunak admin could set their own
`district='TAWAU'` (and `can_write('TAWAU')` then passes) or promote anyone. So
activation must:
- **Scope `profiles` writes by district** — an `upper_admin` may write only rows
  where `profiles.district = ` their own district.
- **Constrain `role` and `district` changes** — an `upper_admin` may not grant
  `upper_admin`, may not change their own `district`, and may not widen their own
  scope. Ordinary `admin`/`viewer` keep no profile-write path at all.
- **Forbid self-escalation.** §5 is the cautionary tale: a naive self-update
  rule once handed viewers the ability to promote themselves. Enforce in RLS,
  and prove it with a mutation-checked test — never trust the UI to hide it.

**3. The `All › Kunak › Tawau …` selector.** **`All` is available to everyone,
read-only across districts** (mutual aid); writes still only work in the
officer's own district — `can_write` already enforces that, so a cross-district
write is refused regardless of what the selector shows. **`All` deliberately
breaks the flat-load** (§7.2 item 5): at many districts it is the full
cross-district pull. Bound it or lazy-load it — do not let `All` become the
default that puts every district on every phone.

**Tests to add then** (extend the `v2-record-sync` T9/T10 pattern, stub the new
policies, mutation-check each): an `upper_admin` cannot touch another district's
profiles; cannot grant `upper_admin`; cannot change their own district; an
`admin`/`viewer` still has no profile-write path; the `All` view reads
cross-district but a cross-district *write* is still refused.

**Cost estimate:** the role tier + `profiles` RLS is ~1 day and is where all the
risk sits; the admin panel is a real feature (~2–3 days); the selector is small.
Sequence the DB/RLS first (as with the foundation — schema before app), and the
same escalation-guard test must be green before it ships.

### 7.5 National-scale map & geography — FUTURE (do when state/district #2 arrives)

**Not built. A written plan for whoever scales past Kunak.** No code, no SQL, no
RLS, no map-library change is implied here — this section only records the
decisions already made about the growth path so the person who onboards
district or state #2 inherits the reasoning instead of re-deriving it. Read
§7.1 (never fork), §7.2 (what breaks), §7.3 (the district foundation, DONE) and
§7.4 (activation) first; this extends all four upward, from one district to a
state and eventually to the whole country.

The scale being planned for: Kunak is ~200 hydrants today. Assume up to **~10k
in one state** and **~100k+ nationally** as the outer envelope. The question
that prompted this: *can the map scale to that without a WebGL/MapLibre
rewrite?* **The answer is yes — and the map is the easy part. The hard part is
roles, tenancy and governance.**

#### 1. Geography is a hierarchy: Malaysia › State › District › Zone

Add a **`state`** tier **above** the existing `district` column, using the exact
same pattern the district foundation used (§7.3): a `state text not null default
'SABAH'` column on `hydrants`, `hydrant_records`, `jadual_pemeriksaan` and
`profiles`, with reads global (mutual aid) and writes scoped. Zones stay derived
from the label's leading letter (§3), never stored — a fourth stored tier is a
fourth thing to drift.

**Do not fork per state or per district.** §7.1 already ruled this out and the
reason is unchanged: `claude_code` and `e-pili-bomba` drifted 7 commits apart
once and officers ran a live app missing fixes. One national Supabase project,
one codebase, RLS-scoped by `state` **and** `district`. **~100k rows is trivial
for one Postgres with the right indexes** — a spatial/composite index on
`(state, district)` and on lat/lng makes every scoped or bounded query cheap.
The database is not the constraint at this scale; nothing about 100k rows argues
for sharding, a second project, or a rewrite.

#### 2. The map scales WITHOUT WebGL — via three legs, not one

The instinct is "just filter by state and it's fine." **The filter alone is not
the whole answer.** Three legs work together, and the middle one is what makes
100k a non-event:

- **(a) State/district filter — bounds the common working set.** Extends §7.2
  item 5 and §7.4: an officer's phone flat-loads only their own district's
  hydrants, Kunak-sized whether the country holds 2 districts or 300. This keeps
  the *everyday* view flat. It does **not**, on its own, answer "show me all of
  Malaysia" — that is what (b) and (c) are for.
- **(b) Bbox / viewport loading + a lat/lng spatial index — draws only one
  screenful.** The map requests only the hydrants inside the current viewport
  bounding box, served by a spatial index. **Any** view — even "All Malaysia"
  zoomed to a city — then draws only one screen's worth of pins, a few hundred
  at most, regardless of whether the register holds 200 or 100k. **This is the
  leg that makes 100k a non-event**, because on-screen pin count stops tracking
  total register size and starts tracking screen area, which is constant.
- **(c) Server-side aggregation (RPC / materialized view) — count bubbles when
  zoomed out.** At the national or state zoom level, showing individual pins is
  neither useful nor drawable. Instead the server returns **per-region COUNT
  bubbles** (per state, then per district) — "Sabah: 4,120", "Kunak: 203" — from
  an RPC or a materialized view. Zooming in hands off from bubbles to (b)'s
  real pins at a threshold zoom. The officer never sees 100k markers because the
  UX never asks for them.

**WebGL / MapLibre is explicitly DEFERRED — someday, probably never.** A vector/
WebGL rewrite is only justified by **100k+ simultaneously on-screen pins** or
heavy vector styling, and the three-leg approach above means this UX never puts
more than a screenful of pins down at once. Leaflet + the current tile stack
stays. Revisit only if a concrete requirement appears that legs (a)–(c) cannot
serve — and note that no requirement seen so far comes close.

#### 3. Measure before building any leg

Do not build (a), (b) or (c) on faith. **Seed a throwaway Supabase branch with
~10k synthetic hydrants, open the "All" view on a real mid-range phone over a
throttled network, and record render time AND payload size.** That single
measurement decides which legs are actually needed and in what order — it is
entirely possible the filter plus bbox loading is enough and aggregation waits.
Same discipline as every other decision in this file: measure on the device and
the network the app is actually used on, never reason from a screenshot or a
desktop.

#### 4. THE HARD PART is governance, not the map

The three legs above are, together, a few days of well-understood work. **The
real work is the role and tenancy model**, and it is where every risk sits. At
state/national scale the §7.4 `upper_admin` (district-manager) tier needs a
**state tier above it** — a JBPM state HQ that manages the districts within its
state — and every governance mechanism gets one layer deeper:

- **Role model grows a tier.** `viewer` < `admin` < `upper_admin` (district
  manager) < **state manager** (or an `upper_admin` scoped to a whole state).
  The `profiles` `role`/scope model from §7.4 extends to carry `state` as well
  as `district`, and "who may provision whom" now spans two levels of
  hierarchy.
- **Provisioning goes one level deeper.** The in-app account panel (§7.4 item 2)
  must scope by `state` as well as `district`: a state manager provisions and
  manages the district managers of *their own state only*, who in turn manage
  their own district's admins and viewers. No cross-state authority, mirroring
  the no-cross-district rule.
- **The self-escalation guard gets harder, and it is the crux.** §7.4 already
  flags that `admins manage profiles` is `using (is_admin())` — any admin can
  today edit any profile's `role` and `district`, which becomes privilege
  escalation the moment there are two districts. Adding a `state` tier widens the
  same hole: a profiles-write rule must now forbid changing one's own `state`,
  granting a tier at or above one's own, or widening one's own scope — across two
  hierarchy levels instead of one. **§5 is the cautionary tale** (a naive
  self-update rule once let viewers promote themselves). Enforce every part in
  RLS, never in the UI, and prove each with a mutation-checked test before it
  ships.
- **The audit trail gets one layer deeper.** `stamp_row_audit()` takes identity
  from the JWT and never the request body (§3, §5); at national scale the audit
  question becomes "which officer, in which district, in which state" — the same
  token-derived identity, one more dimension to record and query.

**Flag for whoever picks this up:** budget the map as the small, measurable part
and the governance/RLS/provisioning as the large, risky part. Do the DB/RLS
first (schema before app, as with the foundation), keep the escalation-guard
tests green, and remember the §8 non-technical risks (single maintainer, support
coverage, account administration, deploy windows) scale *faster* than any of
this — they, not the map, are what end projects at this size.

#### Constraints that still bind at every scale

Nothing here loosens the invariants. `authenticated` **keeps EXECUTE** on
`is_admin()` and `can_write()` (§5); signed rows and signature images stay
permanent, the bucket keeps no UPDATE/DELETE policy; **reads stay global for
mutual aid, writes stay scoped** — now by `(state, district)` rather than
district alone; and the `sql/` scripts are what a recovery actually applies, so
any of this that is ever built changes production **and** the script in the same
step ("change production, change the script", §7 watch-list).

## 8. Non-technical risks

Every technical problem above is measurable and fixable in days. The risks in
this section take **months**, need someone other than the maintainer to approve
them, and are far more likely to end the project.

**8.1 Single maintainer / bus factor — highest risk.**
One person in JBPM understands this system. Not the code — the *why*: why the
card is master for Lokasi, why signed rows are permanent, why the audit column
refuses browser input. At one district, a transfer or long illness means Kunak
returns to paper for a while. At ten, the same event strands ten stations on a
system nobody can change. Government transfers people; this is not
hypothetical. **A single-maintainer system is acceptable for one office and
negligent for ten.**

**8.2 No support coverage.** Today the process is one person who cares. At ten
districts it is 6:15 am and an officer in Semporna cannot sign a record. He
does not know the maintainer and has an inspection to complete. There is no
answer to "who does he call", and no code creates one — it is a person, a
number, and hours they are expected to be reachable. If that person is the
maintainer, they have acquired a second job with no title and no end date.

**8.3 Account administration by hand does not scale.** Promotion is currently
`update public.profiles set role='admin' where email='...'`. At ~200 accounts
across ten districts with constant transfers, the options are: the maintainer
becomes a permanent helpdesk, or ten people get direct production database
access and the first accident deletes real records. An admin screen is the fix,
but the hard part is the policy underneath — **who may grant admin, and who
checks.**

**8.4 No authority to decide features.** Today requirements are simple because
one person decides. At ten districts, Tawau wants an extra column, Lahad Datu
wants different sorting, Semporna wants the card to match their own paper form.
Every request is reasonable and they conflict. Someone must be able to say no
with institutional backing. **This is where most internal government apps
quietly die — not from a bug, but from ten stakeholders and no owner.**

**8.5 Deploy windows.** `publish-to-site.yml` pushes on every commit to main,
which is right for one station whose shifts the maintainer knows. Across Sabah
someone is always mid-inspection. The care that made the signature-bucket change
safe does not scale by being careful — it scales by having a release window and
an approver.

**8.6 No data-correction procedure.** The Kad Rekod is a record of a legal
inspection and signed rows are permanent by design. Within one station a wrong
entry is settled internally. Across ten it is an accusation: a record says an
officer inspected a hydrant on a date they dispute. The audit trail answers
*who wrote it*. It does not say what anyone should **do**. That is a written
procedure agreed above the maintainer's level, and it must exist before it is
needed.

**8.7 Budget and procurement.** Supabase's free tier ends. Ten districts of
records and signature images will pass it, and the images alone stop being
trivial. That becomes a budget line, a procurement process, and a fiscal-year
timeline. If a card expires and nobody renewed it, **the app stops for
everyone** — an administrative failure with a technical blast radius.

**8.8 Training ~200 officers.** Eight officers in one station learn in an
afternoon, in person. Two hundred across ten districts, on shift patterns, with
varying comfort using phones, need written guides in Bahasa Malaysia, video,
and a trainer per station. Skipping this does not stop them using the app — it
makes them use it **wrong**, which produces bad data that people trust.

### The point of this section

| Problem | Fixable by | Timescale |
|---|---|---|
| Map slow with 1,870 pins | Code | An afternoon |
| Rows truncating at 1,000 | Code | An hour |
| Cross-district permissions | Code + SQL | A day |
| Support coverage | A person, assigned | Months, needs approval |
| A second maintainer | A person, trained | Months |
| Who grants admin | Policy | Months |
| Who decides features | Authority | Months |
| Budget | Procurement | A fiscal year |
| Correction procedure | Written policy | Months |

**The problems that can be fixed in a weekend are not the ones that should
worry anyone.**

## 9. Roadmap

### Phase 0 — Before anything else
**Field test on a real phone.** Recent changes to offline behaviour, code
loading and signature display were all verified in a headless browser in a
datacentre. **None has been verified by an officer, at a hydrant, in Kunak.**
No browser can report that a signature feels slow on 3G at Madai, or that the
app does not recover the way an officer expects when signal drops mid-inspection.
Costs nothing and outranks every item below.

### Phase 1 — Make current quality permanent (~1 hour)
- Wire the three test suites into CI and block publishing on failure (6.1)

*Done 2026-08-04:* the private-bucket change was backported into
`sql/supabase-records-setup.sql`, which had still been creating the signatures
bucket as public with an anon-readable policy. Since `RESTORE.md` makes
re-running `sql/` mandatory during recovery, a restore would have silently
re-exposed every signature image. The script's verification query now reports
`bucket_is_private` and `read_is_authenticated_only`, so the same drift is
visible the next time anyone runs it.

### Phase 2 — Hardening (**done except one dashboard toggle**)
- ~~Bound the unbounded hydrant read~~ — done 2026-08-06. `cloudLoad` now pages;
  `cloudFormLoad` was never at risk, it filters by `hydrant_id`. Guarded by
  `tests/hydrant-paging.js`.
- ~~Revoke the RPC grants~~ — done 2026-08-06. `sql/supabase-hardening.sql`
  applied to production and **verified by an admin saving a Kad Rekod row from
  the app**, which is the only check that proves anything: the script's own
  verification query reports success even when every write policy is broken.
  `authenticated` **must keep** `EXECUTE` on `is_admin()` — revoking it blocks
  every admin write.
- **Still open:** enable leaked-password protection (6.1). Dashboard switch,
  no code.

### Phase 3 — District #2 (~2 days) — only when a real second station is willing
- `district` column, scoped permissions, district selector (7.3)
- **One district, not ten.** Run it for three months.

### Phase 4 — Decide from evidence
After three months with two districts, answer questions no architecture
document can: how often the other station makes contact, whether they use it
the way Kunak does, what they ask for that nobody predicted, and whether anyone
there could become maintainer #2.

Only then design for ten. **One extra district generates answers. Ten generate
problems** — and if district #2 goes badly, that is learned at the price of one
station instead of ten.

### Explicitly not planned
- Per-district forks of the app (7.1)
- A state-wide "all of Sabah" dashboard — a different feature with a different
  design, needing a different scan strategy
- Splitting `index.html` before ~6,000 lines or a second developer
- Re-adding the jadual date filter (built, then removed at the user's request)

## 10. Success criteria

The product is succeeding at its current scope if:

1. Officers use it in the field in preference to paper.
2. No inspection data is ever lost — including with no signal.
3. Every signed record is permanent, attributable, and its signature image
   survives a restore.
4. Dashboard figures always reconcile to the underlying records.
5. The deployed app is never behind the source.

Items 2, 3 and 5 each represent a real failure that has already occurred once
and been fixed. They are listed as criteria because they are the ones the
system has actually been tested against.
