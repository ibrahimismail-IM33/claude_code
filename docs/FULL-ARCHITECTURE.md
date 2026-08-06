# e-Pili Bomba Kunak — Full Architecture

Fire-hydrant map and inspection-record system for **BBP Kunak, Sabah** (JBPM).
Live at **epilibomba.com**.

This document describes the system **as it actually is** on 2026-08-04, not as
it was designed or intended. Every claim here was checked against the source,
and the SQL was verified by running all four scripts against a real Postgres.
Known defects are listed in §9 rather than glossed over.

Companion documents: `PRD.md` (what it is for and where it is going),
`CLAUDE.md` (working notes and decision log), `tests/README.md`,
`vendor/README.md`, `RESTORE.md` (in the site repo).

---

## 1. System at a glance

Four layers, three of them managed services. There is no application server of
our own, and no build step anywhere in the pipeline.

```
┌──────────────────────────────────────────────────────────────────────┐
│  OFFICER'S PHONE (Chrome / Safari, in the field, often on 3G)        │
│                                                                      │
│   index.html — 3,267 lines, 238 KB, vanilla JS, no framework         │
│   ├── Map view (Leaflet)        ├── Record card (Kad Rekod)          │
│   ├── Dashboard                 ├── Jadual Pemeriksaan               │
│   └── localStorage cache + offline pending queue                     │
│                                                                      │
│   vendor/ — Leaflet 1.9.4, markercluster, supabase-js 2.112.0        │
│             served from our own origin, never a CDN                  │
└───────────────┬──────────────────────────────────┬───────────────────┘
                │ HTTPS (static assets)            │ HTTPS + WSS (data)
                ▼                                  ▼
┌───────────────────────────────┐   ┌──────────────────────────────────┐
│  CLOUDFLARE PAGES             │   │  SUPABASE (ap-northeast-1)       │
│  ─────────────────────────    │   │  project isxfhocfkjamjchmicwq    │
│  Serves index.html, _headers, │   │  ──────────────────────────────  │
│  vendor/                      │   │  Auth      — email + password    │
│                               │   │  Postgres  — 4 tables, RLS on    │
│  _headers sets CSP, HSTS,     │   │              all of them         │
│  Permissions-Policy           │   │  Storage   — signatures bucket   │
│  (geolocation=(self))         │   │  PostgREST — the only data API   │
└───────────────▲───────────────┘   └──────────────────────────────────┘
                │ auto-publish                        ▲
                │                                     │ pg_dump + storage
┌───────────────┴───────────────┐   ┌─────────────────┴────────────────┐
│  GITHUB — ibrahimismail-IM33  │   │  GITHUB ACTIONS                  │
│  ───────────────────────────  │   │  ──────────────────────────────  │
│  claude_code    (build repo)  │   │  backup-supabase.yml   nightly   │
│    │ publish-to-site.yml      │   │  restore-test.yml      weekly    │
│    ▼                          │   │  publish-to-site.yml   on push   │
│  e-pili-bomba   (deploy repo) │   │                                  │
└───────────────────────────────┘   └──────────────────────────────────┘
```

**Third-party runtime dependencies: none loaded from anyone else's server.**
OpenStreetMap tiles and Google Fonts are the only external origins, and neither
can execute code.

---

## 2. Why there is no backend of our own

Officers needed this working, on their phones, without a server to administer,
a deployment to schedule, or a hosting bill to justify. Supabase provides
Postgres, authentication and file storage behind one HTTPS API; Cloudflare
Pages serves a single static file.

That choice moves the entire security burden into **Row-Level Security**. The
browser holds a publishable key and talks to the database directly. There is no
middle tier that can enforce rules, so **if a rule is not expressed as an RLS
policy or a database trigger, it is not enforced at all.** Anything the client
checks is a convenience for the officer, never a control.

This is the single most important thing to understand before changing anything.

---

## 3. The client — `index.html`

One file, no build step, no bundler, no framework. The file you edit is the
file that runs.

### 3.1 Why one file

| Cost of one file | Cost of splitting |
|---|---|
| Hard to navigate at 3,267 lines | A build step |
| Two developers cannot edit it without conflicts | Node + npm required to deploy |
| No module boundaries | A compile stage that can silently ship a broken bundle |

With a single maintainer and one station, the second column is worse than the
first. **Revisit at ~6,000 lines, or the day a second developer joins** — and
split by *feature* (map / dashboard / record card), never by district.

### 3.2 Module map

The code is not split into files, but it is organised into clear regions.
Line numbers are indicative and will drift; the function names are stable.

| Region | Key functions | Responsibility |
|---|---|---|
| **Local persistence** | `persist`, `loadHydrants`, `storageOK`, `loadForm`, `saveForm`, `formKey` | localStorage is the primary read source. The app is usable with no network at all |
| **Cloud sync** | `cloudProbe`, `cloudLoad`, `cloudSave`, `cloudInsertNew`, `cloudFormLoad`, `cloudFormSave`, `pullFresh` | All Supabase traffic. `cloudStatus` drives the visible "Data awan ✓ / Data tempatan" indicator |
| **Offline queue** | `pendKey`, `savePending`, `loadPending`, `pendingIds`, `hasPending`, `snapCloudBase`, `baseFor`, `flushPending`, `flushAllPending`, `sameData` | The P0 safety net. See §5.2 |
| **Map** | `initMap`, `renderMarkers`, `makeIcon`, `tip`, `renderPills`, `visible`, `searchMatches` | Leaflet + markercluster. 187 markers in 7 clusters |
| **Registry & detail** | `renderRegistry`, `openDetail`, `detailSig`, `reopenDetailIfOpen`, `openAdd`, `closeAdd` | The hydrant list and its popup |
| **Record card** | `openForm`, `buildFormHtml`, `headerBlock`, `renderTable`, `wireForm`, `wireCells`, `collectForm`, `normalizeForm`, `blankForm`, `emptyRow`, `rowHasData`, `formFingerprint`, `lockSignedUI` | The Kad Rekod Pili Bomba |
| **Signatures** | `sigPath`, `resolveSigs`, `paintSigs`, `fallbackRest`, `dataUrlToBlob`, `stripSignatureBg` | Capture, upload, and short-lived link resolution |
| **Derived sync** | `syncLocation`, `syncLastInspected`, `latestPengujianDate` | Fields the record card owns and pushes back onto the hydrant |
| **Dashboard** | period helpers (`halfList`, `halfRange`, `periodRange`), `refreshInspIndex`, donut geometry | Derives every figure from Pengujian rows |
| **Jadual** | `jadualLoad`, `jadualSorted`, `jadualInPeriod` | Shared inspection schedule |
| **Auth & UI shell** | `signInWithPassword`, `getSession`, `signOut`, role badge, account menu | The login gate and header |

### 3.3 Runtime constants worth knowing

| Constant | Value | Meaning |
|---|---|---|
| `PULL_MIN` | `10000` | Minimum 10 s between background pulls — protects a field connection |
| `PULL_EVERY` | `60000` | Idle poll while the tab is visible |
| `SIG_TTL` | `3600` | Signed signature links live one hour |
| `SCAN_PAGE` | `1000` | Dashboard scan page size, matching the PostgREST cap |
| `SCAN_MAX` | `50` | Hard stop so a malformed response cannot loop forever |
| `SEC_ORDER` | `kerosakan, pemantauan, pengujian, kompaun` | The four record-card sections |

### 3.4 Local storage keys

| Key | Holds |
|---|---|
| `bbpkunak_hydrants` | The hydrant list |
| `bbpkunak_form_<id>` | One hydrant's record card |
| `bbpkunak_pending_<id>` | Unsent edits for that hydrant, plus the cloud values they were based on |

---

## 4. Data model

### 4.1 `public.profiles`
```sql
id         uuid primary key references auth.users(id) on delete cascade
email      text
full_name  text
role       text not null default 'viewer' check (role in ('admin','viewer'))
created_at timestamptz default now()
```
New accounts are `viewer`. Promotion is a manual SQL statement — there is no
admin screen. See `PRD.md` §8 for why that does not survive expansion.

### 4.2 `public.hydrants`
```sql
id         bigint primary key
label      text not null            -- No. Pili Bomba, e.g. 'A01'
lat, lng   double precision not null
status     text not null default 'kerajaan'   -- 'kerajaan' = Awam | 'swasta'
location   text                     -- Alamat; the record card is master
updated_at timestamptz default now()
updated_by text                     -- added by supabase-audit-setup.sql
```

187 rows: **170 Awam** + **17 Swasta** (`A26` and `A92`–`A107`, all at Kilang
T.S.H Wilmar). Labels are zoned — `A**` Kunak town, `B**`/`C**`/`D**` Madai,
`E**` Pangi.

**There is no `district` column.** Labels are therefore unique only within
Kunak. This is the central obstacle to expansion; see `PRD.md` §7.

### 4.3 `public.hydrant_records`
```sql
hydrant_id bigint  not null references public.hydrants(id) on delete cascade
section    text    not null   -- header|kerosakan|pemantauan|pengujian|kompaun
row_index  int     not null
data       jsonb   not null default '{}'
signed     boolean not null default false
signed_by  text                     -- email of the admin who signed
signed_at  timestamptz
signature  text                     -- storage path (legacy rows hold a URL)
updated_at timestamptz default now()
updated_by text
primary key (hydrant_id, section, row_index)
```

One row = one line of one section of one hydrant's card. The `jsonb` column
means adding a field to the paper form needs no migration.

### 4.4 `public.jadual_pemeriksaan`
```sql
id         bigint generated by default as identity primary key
tarikh     date not null            -- planned visit date
pasukan    text not null            -- team, e.g. 'Pasukan A'
lokasi     text not null            -- place, e.g. 'Hospital Kunak'
created_by text
created_at timestamptz default now()
```
Indexed on `tarikh`. There is deliberately **no "done" flag** — a signed
Pengujian row already proves the visit happened, and a second marker would
drift from it. Rows carry a place, not a hydrant, because one visit covers a
location that may hold several pili.

### 4.5 Storage — `signatures` bucket

One PNG per signed row, background stripped client-side by `stripSignatureBg`.
Currently 8 images, 1.1 MB. **The signature is the evidence** — this bucket is
as important as the database, and was for a long time the least protected part
of it — public to anyone holding a URL, and missing from the backup entirely
(`CLAUDE.md` §4.11). Both are now fixed: the bucket is private, reads require a
signed-in user, and every image is in the nightly backup.

---

## 5. Key flows

### 5.1 Saving a record card — online

```
Officer types
    │
    ▼
saveForm(id, f)
    ├── localStorage  ← written first, always, unconditionally
    ├── syncLocation(id, f)       → hydrant.location, if non-blank
    ├── syncLastInspected(id, f)  → hydrant.lastInspected
    └── cloudFormSave(id, f)
            ├── success → snapCloudBase(id, rows)   [record the new base]
            └── failure → savePending(id, ...)      [park it, see 5.2]
```

`syncLocation` never overwrites with a blank, so clearing the card field cannot
wipe a registered address.

### 5.2 Saving a record card — offline, and the flush

This is the system's most carefully considered path, because getting it wrong
once destroyed real field data (`CLAUDE.md` §4.10).

```
Save fails (no signal)
    │
    ▼
bbpkunak_pending_<id> = { rows typed, base = cloud values they were based on }
    │
    │  ... officer keeps working, banner on card, amber '!' on the map pin ...
    │
    ▼
Reconnect  (visibilitychange | focus | online | 60 s poll)
    │
    ▼
flushPending(id) — re-reads the cloud, then per row:

    cloud row is signed        → KEEP pending, never touch a signed row
    cloud row does not exist   → PUSH, there is nothing to lose
    base == current cloud      → PUSH, nobody else changed it
    base != current cloud      → HOLD as a conflict:
                                 cloud wins, officer is warned and
                                 shown exactly what they typed
```

The rule is deliberate: **silently picking a winner is what caused the original
loss.** A row nobody else touched syncs with no warning at all.

A flush that fails pushes nothing back into the void: anything not confirmed
stays parked. Dropping a failed push from the queue would put the officer's
typing back in exactly the position this whole mechanism exists to prevent —
still in the form cache, no longer flagged as unsent, and overwritten by the
cloud on the next open.

### 5.2a Clearing a row

An upsert only writes the rows it is sent, so a cleared row has to be sent as a
**delete** or it never happens at all:

```
Officer empties a row, saves
    │
    ▼
deadRows(id, f)   rows now empty that the cloud snapshot says it still holds
    │             · never a signed row — the client does not even ask
    │             · admin only — a viewer's delete is refused by RLS
    │             · no cloud snapshot this session => delete nothing
    ▼
upsert the rows with content  →  delete the dead ones  →  snapCloudBase
```

Offline, a removal is parked as an explicit `{section, row_index, removed:true,
base}` marker — there is no data to carry, so without the marker the clear
would simply evaporate. On reconnect it follows the same conflict rules as any
other row: signed → never touched, absent → already done, matches base →
deleted, differs → held back and shown to the officer.

The row keeps its place on the card as an empty row; only the database row
goes. The dashboard needs no special handling — `scanCloud` reads the Pengujian
rows directly, so a deleted row drops that hydrant to "Belum diperiksa" by
itself. `syncLastInspected` clears the pin's date badge once no dated Pengujian
row remains, so the map and the dashboard cannot disagree.

Guarded by `tests/p0-offline-sync.js`, which was verified to **fail** on the
pre-fix code.

### 5.3 Signatures

```
Capture (canvas)
    → stripSignatureBg   remove paper background
    → dataUrlToBlob
    → upload to signatures bucket, path stored in hydrant_records.signature
    → row marked signed / signed_by / signed_at
    → RLS policy AND trg_protect_signed now both refuse any change

Display
    openForm renders the card immediately with .sigwait placeholders
    → resolveSigs()  one batched createSignedUrls(paths, 3600)
    → paintSigs()    swaps placeholders for <img> in place, no rebuild
    → SIG_CACHE holds each link for its hour
    → any failure at any point → fallbackRest(f) uses the stored value
```

Two separate defects shaped this. The card used to **wait** on the signing
round trip, so signatures appeared late; it now renders first and paints after.
And an early version of the placeholder broke the fallback, leaving the cell
blank forever when signing was unavailable — hence `fallbackRest` on *every*
failure path. Guarded by `tests/signature-links.js`.

### 5.4 Cross-device refresh

The app used to read the cloud once at startup and then show its cache, so a
second device only caught up when each hydrant was opened by hand.

```
visibilitychange (to visible) ─┐
focus ─────────────────────────┼─→ flushAllPending() + pullFresh()
online ────────────────────────┤
setInterval 60 s while visible ┘

pullFresh(force)
    throttled to one pull per 10 s
    → cloudLoad(quiet = true)
    → if the Dashboard tab is open: refreshInspIndex() + jadualLoad()
```

A background pull sets `noFitOnce`, so `renderMarkers` updates the pins but
**never re-fits the map**. Without that, a hydrant added by someone else would
change the fit key and jump the map away from what the officer is reading.

### 5.5 Where the dashboard's numbers come from

The dashboard stores nothing of its own. Every figure is derived from the same
Pengujian rows the record card already writes:

| Figure | Definition |
|---|---|
| **Diperiksa** | A Pengujian row in the period, **signed** |
| **Belum di-sign** | A row in the period, not yet signed |
| **Belum diperiksa** | No Pengujian row in the period |

One source of truth, nothing to drift.

The scan pages through `hydrant_records` ordered by `hydrant_id, row_index` so
`range()` cannot repeat or skip. Before that fix, past 1,000 rows the extras
were dropped and those hydrants counted as never inspected — it would have read
~67 hydrants and reported 120 as outstanding.

Scope follows the Awam/Swasta pills exactly, including cleared = Semua.

---

## 6. Security architecture

### 6.1 The model in one line

**Any signed-in user reads. Only `admin` writes. Signed rows are permanent.**

### 6.2 `is_admin()`

```sql
create or replace function public.is_admin()
returns boolean language sql stable security definer
set search_path = public
as $$ select exists (select 1 from public.profiles
                     where id = auth.uid() and role = 'admin'); $$;
```

`SECURITY DEFINER` is required — reading `profiles` from inside a `profiles`
policy would recurse. `search_path` is pinned, which closes the usual
escalation route.

### 6.3 Every RLS policy, as it exists

| Table | Policy | Effect |
|---|---|---|
| `profiles` | `read own profile` | select: own row, or any row if admin |
| | `admins manage profiles` | all: admin only |
| `hydrants` | `auth read hydrants` | select: any authenticated |
| | `admin insert/update/delete hydrants` | write: admin only |
| `hydrant_records` | `auth read records` | select: any authenticated |
| | `admin insert records` | insert: admin only |
| | `admin update unsigned records` | update: admin **and `signed = false`** |
| | `admin delete unsigned records` | delete: admin **and `signed = false`** |
| `jadual_pemeriksaan` | `auth read jadual` | select: any authenticated |
| | `admin insert/update/delete jadual` | write: admin only |
| `storage.objects` | `signatures read` | select: **authenticated only** on the bucket |
| | `signatures write` | insert: authenticated **and** admin |

The bucket is **private**. `to authenticated` on the read policy is the load-
bearing part: without it the rule applies to `{public}`, which includes `anon`,
and a private bucket with an anon-readable policy is not private at all.

There is deliberately **no update or delete policy on `storage.objects`** for
this bucket, so an uploaded signature image can never be replaced or removed.

### 6.4 Two independent locks on signed rows

The `signed = false` condition in the policies is the first. The second is a
trigger that does not depend on the policies being correct:

```sql
create trigger trg_protect_signed
  before update or delete on public.hydrant_records
  for each row execute function public.protect_signed_rows();
```

It raises an exception on any update or delete of a row where `OLD.signed` is
true. If the policies were ever loosened by mistake, this still refuses.

### 6.5 The audit trail, and why it takes no input from the browser

```sql
new.updated_by := nullif(current_setting('request.jwt.claims', true), '')
                    ::jsonb ->> 'email';
```

Identity comes from the **login token inside the database**. There is no
fallback to anything the request body contains.

The first version used `coalesce(jwt_email, new.updated_by)`, which let a
modified page write any name it liked into the audit trail. It was caught only
because a test planted `liar@example.com` and asserted rejection — testing the
happy path would have passed and shipped the hole.

**An audit field the client can set is decorative.** Where there is no token at
all (service role, a restore, a scheduled job) the column is left NULL rather
than trusting the caller.

`trg_stamp_audit` is named to sort **after** `trg_protect_signed`, so the
rejection of a signed-row change wins before anything is stamped.

### 6.6 Content-Security-Policy

```
default-src 'self';
script-src  'self' 'unsafe-inline';
style-src   'self' 'unsafe-inline' https://fonts.googleapis.com;
font-src    'self' https://fonts.gstatic.com;
img-src     'self' data: blob: https://tile.openstreetmap.org
            https://*.tile.openstreetmap.org
            https://isxfhocfkjamjchmicwq.supabase.co;
connect-src 'self' https://isxfhocfkjamjchmicwq.supabase.co
            wss://isxfhocfkjamjchmicwq.supabase.co;
frame-ancestors 'none'; base-uri 'self'; form-action 'self'; object-src 'none'
```

`script-src 'self'` is only possible because the libraries are self-hosted.
A script from a CDN would run with full access to the signed-in session and
every record card, and `@supabase/supabase-js@2` floated — whatever the CDN
called "latest 2.x" would reach every officer with no review. Self-hosting
removes the path entirely; SRI would only have detected a change, not prevented
the exposure.

`'unsafe-inline'` on `script-src` remains because the app is one inline
`<script>`. Removing it means either external JS files or a nonce, and neither
is worth a build step today.

Guarded by `tests/csp-and-vendor.js`, which boots the real app under the CSP
parsed out of `_headers` and fails if a CDN tag ever reappears.

---

## 7. Deployment

### 7.1 The pipeline

```
developer → claude_code (main)
                │  publish-to-site.yml
                │    copies ONLY index.html, _headers, vendor/
                │    refuses if a CDN tag reappears
                │    refuses if sql/ or tests/ would become public
                │    leaves login-bg.jpg, README.md, .github/ alone
                ▼
            e-pili-bomba  ──→ Cloudflare Pages ──→ epilibomba.com
```

Two repositories exist because Cloudflare publishes everything in the repo it
is pointed at, and `sql/` and `tests/` must never be public. They once drifted
**7 commits apart** and officers used a live app missing fixes — so the copy is
automated and must never be done by hand. Authentication is the
`SITE_REPO_TOKEN` secret, a fine-grained token scoped to the site repo with
Contents: read and write.

### 7.2 Backup and restore

| Workflow | When | What |
|---|---|---|
| `backup-supabase.yml` | nightly | `pg_dump` of `public` + `auth.users`, **plus every signature image** and a `storage-objects.csv` mapping file to record. Fails loudly if any image is missing. Opens a GitHub issue on failure (needs `permissions: issues: write`) |
| `restore-test.yml` | weekly (Mon) | Downloads the newest backup, restores into a throwaway Postgres, checks counts and images, opens an issue on failure |

First verified restore, 2026-08-03: **188 pili, 31 rekod, 8 bertandatangan,
8 valid images.**

**A restore does not bring back the security layer.** That same run proved 16
statements fail on a bare Postgres — every RLS policy, plus the
`profiles → auth.users` link, because there is no `authenticated` role and no
`auth` schema. **Re-running everything in `sql/` is a mandatory recovery step,
not a tidy-up.** Skipping it leaves every record writable by anyone signed in.

Retention is 90 days in GitHub artifacts, which vanish with the repository.

---

## 8. Testing

Four Node + Playwright suites, **76 assertions**, driving the real page in
real Chromium.

| Suite | Guards | Assertions |
|---|---|---|
| `p0-offline-sync.js` | Offline field data survives and reaches the server; conflicts warn instead of overwriting; signed rows untouched; reconnect pushes without the card being opened | 20 |
| `csp-and-vendor.js` | No CDN tag or origin anywhere; every vendor file present; the app boots under the real CSP with real Leaflet — 187 pins, 7 clusters, zero violations | 21 |
| `clear-row.js` | An officer can withdraw a wrong entry; signed rows stay untouchable; clearing works offline and survives a contested sync; the pin's date badge follows the rows that remain; a failed flush changes nothing | 22 |
| `signature-links.js` | Signatures resolve to short-lived links and **fall back** when signing is unavailable; covers legacy URLs and paths | 13 |

The standard, from `tests/README.md`: **a test earns its place by failing on the
broken code.**

### CI, and the gate

`.github/workflows/tests.yml` runs all four suites on **every push and pull
request**. `publish-to-site.yml` calls that same workflow and depends on it:

```yaml
jobs:
  test:
    uses: ./.github/workflows/tests.yml
  publish:
    needs: test
```

**The dependency is the deliverable, not the workflow.** A CI job that reports
red while the broken build ships anyway is decoration; `needs: test` is what
stops a regression reaching an officer's phone. If either `workflow_call` in
`tests.yml` or `needs: test` here is ever removed, the gate detaches and
nothing appears to break.

`package.json` exists only for this — `playwright` as a dev dependency and the
three `npm run test:*` scripts. **The app itself still has no build step and no
runtime dependency on npm**; runtime libraries stay self-hosted in `vendor/`,
and `publish-to-site.yml` copies only `index.html`, `_headers` and `vendor/`,
so nothing from `node_modules` can reach the site.

CI asks Playwright for its own Chromium path rather than hardcoding the dev
container's `/opt/pw-browsers/chromium`, so a version bump needs no CI change.

Not covered by committed tests: dashboard figures and donut geometry, the
jadual round trip against a real table, the login gate and roles, record-card
validation, map filters and search. All verified by hand, none guarded.

---

## 9. Known defects in this architecture

Stated plainly. None is secret and none is currently causing harm.

**1. Two unbounded queries.** `cloudLoad` and `cloudFormLoad` have no
`.range()`. PostgREST caps a response at 1,000 rows and reports no error. At
187 hydrants this is latent; it becomes real around five districts.

**2. `SECURITY DEFINER` functions are exposed as RPC** to `anon` and
`authenticated`. `search_path` is pinned, so there is no escalation path — this
is an unnecessary surface, not a vulnerability.

**3. Seven of eight accounts are admin.** Every one can write any hydrant and
any record. Accepted deliberately, with the audit trail added in compensation.

**4. Leaked-password protection is off** in Supabase Auth.

**5. Backup retention is 90 days** and lives inside the GitHub account it
protects.

---

## 10. Conventions for anyone changing this

- **The app's CSS is global.** `.card`, `.btn`, `.pill`, `.mono` are taken.
  Scope anything new — the dashboard lives under `#dashView`.
- **Colour carries meaning, never decoration.** Navy `#003049` is 1.42:1 on
  the dark background and is a fill-only colour; substitute `#9CAAB6` for text.
- **Verify in a real browser before saying it works.** Chromium is at
  `/opt/pw-browsers/chromium`. Several bugs were invisible in a screenshot and
  only appeared when measured.
- **This is a live government app.** Prefer a small verified change over a
  large plausible one, and sequence changes so there is never a moment when a
  working build is broken for officers mid-shift.
- **Anything the client enforces is a convenience.** Rules live in RLS and
  triggers or they do not exist.

---

*Last verified against the source: 2026-08-04, branch
`claude/epilibomba-build-compile-3hhuqp`, commit `764c988`.*
