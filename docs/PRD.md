# e-Pili Bomba Kunak — Product Requirements Document

| | |
|---|---|
| **Product** | e-Pili Bomba Kunak |
| **Owner** | Ibrahim Ismail, BBP Kunak (JBPM Sabah) |
| **Status** | Live in production at epilibomba.com |
| **Scope today** | One district — BBP Kunak. 187 hydrants, 8 accounts |
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
   requires reading 187 cards by hand, so in practice it is not asked.

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
- 187 hydrants on OpenStreetMap, clustered.
- Pin colour by ownership: **Awam** (`kerajaan`, 170) / **Swasta** (17).
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
cannot compete with 187 markers loading.

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

| | |
|---|---|
| Hydrants | 187 (170 Awam, 17 Swasta) |
| Records | 31, of which 8 signed |
| Signature images | 8, 1.1 MB |
| Accounts | 8, of which 7 admin |
| Districts | 1 |
| Codebase | `index.html`, 3,267 lines, 238 KB, no build step |
| Tests | 4 suites, 76 assertions — run by CI on every push |
| Backups | Nightly, verified weekly by automated restore |

## 6. Open issues

### P1 — none outstanding

*Both closed 2026-08-04.* `sql/` was brought back in step with production, and
the test suites now run in CI on every push with publishing blocked on them
(`tests.yml` + `needs: test`). See §9 Phase 1.

### P2 — Hardening. Real, but nothing is on fire

**6.1 Unbounded queries.** `cloudLoad` and `cloudFormLoad` have no `.range()`.
PostgREST caps a response at 1,000 rows and reports no error. Latent at 187
hydrants; certain at ~5 districts. Silent wrong numbers are the worst class of
bug — the same failure mode would have reported 120 Kunak hydrants as never
inspected.

**6.2 `SECURITY DEFINER` functions exposed as RPC** to `anon` and
`authenticated`. `search_path` is pinned, so there is no escalation path.
Unnecessary surface, not a vulnerability. Revoke the grants.

**6.3 Leaked-password protection is off.** One switch in Supabase Auth.

**6.4 Seven of eight accounts are admin.** Accepted deliberately, with the
audit trail added instead. Revisit if headcount grows.

### P3 — Needs a decision, not just code

**6.5 Backup retention is 90 days** in GitHub artifacts, which vanish with the
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

### 7.2 What actually breaks

| # | Problem | Detail |
|---|---|---|
| 1 | **No `district` column** | Not on hydrants, records or jadual. Today everything *is* Kunak; the day it is not, every row is ambiguous |
| 2 | **Label collision** | `A01`–`E**` are zoned to Kunak. Another district will also want `A01` |
| 3 | **Global write access** | `is_admin()` grants write everywhere. A Lahad Datu officer could edit Kunak's records |
| 4 | **The 1,000-row wall** | ~5 districts crosses it. Rows stop arriving, nothing errors |
| 5 | **Wasted load** | Without the column the database cannot filter, so every phone downloads every district |

On (5): a Kunak officer still inspects the same 187 hydrants no matter how many
districts exist. Without a `district` column their phone would download ~1,870
at ten districts and discard 90%. **The column is what keeps each officer's
load flat** — 187 rows whether there are 2 districts or 30. Caching does not
help here: it makes a correct answer cheaper, but it cannot make a truncated
answer correct.

### 7.3 The change, when it is wanted

**Database** — add `district` to `hydrants`, `hydrant_records` and
`jadual_pemeriksaan` (default `'KUNAK'`) and to `profiles`; extend `is_admin()`
into `can_write(target_district)` so writes are scoped to the officer's own
station while reads stay global for mutual aid; make labels unique per
`(district, label)`.

**App** — one district selector defaulting to the officer's own; every query
filtered by it. Bound `cloudLoad` and `cloudFormLoad` with `.range()`
regardless — the dashboard scan already pages correctly and is the pattern to
copy.

**Tests** — extend `p0-offline-sync.js` with a cross-district permission case:
an officer of district A must be rejected writing district B. Confirm it fails
on the pre-change code.

**Cost: about two days, once.** After that each new district is a data-entry
job, not an engineering project. Forking is cheaper the first time and costs
forever afterwards.

**Expected file growth: 300–500 lines, about 15%.** District logic is a filter,
and filters are cheap. Split the file by *feature* at ~6,000 lines or when a
second developer joins — never by district.

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

### Phase 2 — Hardening (~2 hours, no user-visible change)
- Bound `cloudLoad` and `cloudFormLoad` (6.1)
- Revoke the RPC grants (6.2)
- Enable leaked-password protection (6.3)

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
