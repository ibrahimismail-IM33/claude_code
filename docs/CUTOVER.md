# V2 cutover — the ordered checklist

What has to happen for officers at epilibomba.com to get V2 instead of V1, in
order, with the rollback.

Read this before scheduling a date. **The one-line summary that used to sit in
`docs/STAGING.md` §5 — "cutover is one merge of `claude/epb-v2` to `main`" —
is wrong**, and §1 below is why. Merging is necessary. It is not sufficient,
and on its own it does nothing at all.

---

## 0. The gates, before any of this

Neither is code and neither can be skipped.

| Gate | Why it is a gate |
|---|---|
| **One Kad Rekod printed on the real printer** | Three print defects in this app's history; **three found on paper, none found by any other means**. Faded ink, then a black box, then a nearly-erased signature. The screen was wrong every time. V2 *moved the card into a component*, which already broke printing once — the whole card came out as a blank sheet and nothing on screen changed. `docs/KAD-REKOD.md` marks this MANDATORY |
| **The offline round trip on a real phone** | Aeroplane mode → edit → amber `!` on the pin → reconnect → confirm from a second device. Both P0s in this app (§4.10 data destruction, §4.13 a row that could never be cleared) were found this way, by a person using it |

Staging confirmed sign-in, the map, the dashboard and the Kad Rekod **on
screen** (CLAUDE.md §8, 2026-08-09). That is not the same claim as either row
above.

---

## 1. ⚠ The publish pipeline cannot publish V2 as it stands

This is the part that makes cutover more than a merge, and it fails **silently**
— which is the dangerous kind.

`.github/workflows/publish-to-site.yml` copies the V1 app to the site repo
(`ibrahimismail-IM33/e-pili-bomba`), which is what Cloudflare actually serves.
Four things about it are V1-shaped:

1. **It publishes V1 and reports success.** It runs on pushes to `main`
   touching `index.html`, `_headers`, `vendor/**`, or itself. V2's code all
   lives in `v2/`, and `index.html` and `_headers` are deliberately
   byte-identical to `main` — but `claude/epb-v2` *does* change
   `vendor/README.md`, which matches `vendor/**`. So the workflow **fires**,
   the suites pass, it copies V1's `index.html` to the site repo unchanged, and
   the run goes **green**.

   That is worse than not firing. A successful publish is exactly the signal
   someone would read as "cutover done", and what reached officers is still V1.
   Note also how incidental it is: whether this workflow runs at all currently
   depends on whether a README happened to change. Either way no V2 is
   published — the paths it copies contain none.
2. **There is no build step.** It copies files verbatim. V2 is a Vite bundle
   that has to be built into `dist/`.
3. **It copies the wrong paths.** `index.html` at the repo root is V1. V2's
   page is `dist/index.html`, and V2's headers are `dist/_headers` (built from
   `v2/public/_headers`), not the root `_headers`.
4. **Its own guard would reject V2.** The "Refuse to publish a broken build"
   step requires `vendor/leaflet.js`, `vendor/supabase.js`,
   `vendor/images/marker-icon.png` and friends to be present in the published
   tree. A V2 `dist/` has none of them — everything is bundled.

**So a merge with no workflow change leaves officers on V1 while every
indicator — the merge, the suites, the publish run, the new commit in the site
repo — says cutover succeeded.** That is precisely the failure this project
has already had once: the site repo sat 7 commits behind and officers used a
live app missing fixes (CLAUDE.md §3). The publish workflow exists *because* of
that incident, so re-creating it during cutover would be a poor way to repay it.

### What the workflow has to become

- **Trigger** on `v2/**`, `vite.config.mjs`, `package.json`, `scripts/**` and
  itself, as well as the V1 paths (keep those — see rollback).
- **Build**: `npm ci && npx vite build && node scripts/verify-bundle.js`.
- **Copy `dist/`** into the site repo instead of `index.html` + `_headers` +
  `vendor/`.
- **Rewrite the guard** for the V2 tree: `index.html` and `_headers` present,
  `assets/` non-empty, no `harness.html`, no `harness-*` bundle, no `sql/`, no
  `tests/`, no CDN origin. Much of this duplicates `verify-bundle.js`; prefer
  calling that script over writing the checks twice.
- **Keep `needs: test`.** The gate on `tests.yml` via `workflow_call` is the
  point of the whole file. A publish that ships while the suites are red is
  decoration.
- **Do not delete `login-bg.jpg`** from the site repo. `dist/assets/style-*.css`
  references it at the site root and Vite deliberately leaves it unresolved
  (the build prints `login-bg.jpg … will be resolved at runtime`). Deleting it
  gives every officer a login screen with no background.
- **Leave `vendor/` in the site repo.** V2 does not use it, but it costs
  nothing and it is what makes the rollback in §5 instant.

---

## 2. ⚠ `verify-bundle.js` will fail the moment noindex is removed

`scripts/verify-bundle.js` asserts `X-Robots-Tag: noindex` is present, because
staging carries real hydrant data and real officer logins and must never be
indexed. **Production must be the opposite** — epilibomba.com should be
indexable, and step 3 removes that line.

The check is currently unconditional, so removing the line **fails the build**,
which fails the deploy. Make the check environment-aware before cutover day —
required on staging, and required *absent* on production — rather than deleting
it, or staging loses the protection silently the next time someone re-runs it.

---

## 3. The cutover itself

1. **Remove `X-Robots-Tag: noindex, nofollow`** from `v2/public/_headers`.
   Nothing else in that file changes. `tests/v2-csp.js` asserts staging and
   production policies differ in `script-src` alone, so any other drift fails
   there.
2. **Update `publish-to-site.yml`** per §1, and `verify-bundle.js` per §2.
3. **Merge `claude/epb-v2` into `main`.** Keep the merge commit clean — nothing
   unrelated in it, because §5 depends on reverting exactly this.
4. **Watch the Actions run.** `tests.yml` must pass (26 suites, 961 assertions
   at the time of writing) before publish runs at all.
5. **Confirm the site repo actually changed.** Open
   `ibrahimismail-IM33/e-pili-bomba` and check there is a new commit and that
   `index.html` is the V2 bundle page, not the V1 single-file app. If the
   workflow reports success but the site repo has no new commit, §1 is not done.

---

## 4. Verify on epilibomba.com, in this order

- The **login gate** appears. An empty map means sign-in or RLS, not hosting.
- **Response headers** — devtools → Network → the document → Response Headers.
  `Content-Security-Policy` with `script-src 'self'` and **no** `'unsafe-inline'`,
  `Permissions-Policy` with `geolocation=(self)`, and **no** `X-Robots-Tag`.
- The **map** renders as a continuous tile grid on first load (CLAUDE.md §4.17).
- The **dashboard** figures are non-zero and reconcile to the register.
- **Guna Lokasi Saya** prompts for location. Nothing else surfaces a broken
  `Permissions-Policy`.
- Open a **Kad Rekod** and print one. Yes, again — this is a different build
  and a different host from the staging printout.

---

## 5. Rollback

**Revert the merge commit on `main` and push.** The V1 `index.html`, `_headers`
and `vendor/` are still in the repo and untouched by the migration, so the
reverted publish restores the exact app officers used before.

Two conditions make this work, and both are set up above: the publish workflow
must still trigger on the V1 paths (§1), and `vendor/` must still be present in
the site repo (§1). Check both **before** cutover — a rollback path first
exercised during an incident is not a rollback path.

The staging Pages project can stay up. It costs nothing and it is where the
next change gets tried.

---

## 6. Housekeeping, not blocking

- **Six merged phase branches are still on origin** (`claude/epb-v2-p0-seams`
  … `-p5-kad`). Fully merged, so nothing is lost. Keep Cloudflare's **preview
  deployments off** while they exist — with previews on, each gets its own live
  URL **writing to the production database**.
- **`docs/STAGING.md` §5** still carries the "one merge" summary. Correct it to
  point here.
- **The register showed 203 pili** (186 Awam + 17 Swasta) where the notes said
  188 a week earlier. Read off a stale staging build, so it may mean nothing —
  but confirm it before cutover rather than after.
