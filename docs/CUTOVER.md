# V2 cutover — putting the V2 bundle on epilibomba.com

The ordered checklist, with the rollback. Read §2 before doing anything: the
route chosen here changes what gates a release, and that is a decision worth
understanding rather than discovering.

**Status:** staging has been used against the production database, and V2's Kad
Rekod printed correctly on a real printer on 2026-08-09.

**⚠ That paper gate is STALE and must be re-run before the domain moves.** Seven
commits have touched the card, its print CSS or the signature print path since:
the viewer read-only change (`.factions` markup, `.ro-note`), the signature
erasure fix, the print-copy build path, the print isolation fix for the app's
decoration, and three card/gate changes. `docs/KAD-REKOD.md` is binding under
MS ISO PS-8 and requires a printout after exactly these. It costs one sheet of
paper; four print defects have been found on paper and none by any other means.

---

## 1. How epilibomba.com is served — before and after

**Today.** `publish-to-site.yml` copies three paths — `index.html`, `_headers`,
`vendor/` — from `main` into a second repo, `ibrahimismail-IM33/e-pili-bomba`,
and Cloudflare Pages serves that repo's root as static files. Those three paths
are V1. It cannot publish V2: there is no build step, V2's app is a Vite bundle
under `v2/`, and the workflow's own guard requires `vendor/leaflet.js` and
friends that a V2 `dist/` does not contain.

**Corrected 2026-08-13.** This section used to say that merging
`claude/epb-v2` into `main` fires that workflow via a change under `vendor/**`.
It does not. `publish-to-site.yml` has a `paths:` filter — `index.html`,
`_headers`, `vendor/**` and its own file — and a V2-only merge touches none of
them. Verified against three consecutive V2 merges this week: `Tests` ran each
time, `Publish to site` did not fire at all.

The warning the paragraph existed to give still stands, in a slightly different
shape: **a green Actions run is not a cutover.** If a merge does happen to touch
a V1 path, the publish runs, the suites pass, and it copies V1's unchanged
`index.html` — a success that means officers are still on V1. Read what the run
published, not that it was green.

**After.** A Cloudflare Pages project builds `claude_code` directly and serves
`dist/`, exactly as staging does — but from the **`release`** branch, which CI
only advances when the suites pass (§2). The site repo stops being the source
for epilibomba.com and becomes the rollback target.

---

## 2. The gate is KEPT — Pages watches `release`, not `main`

An earlier version of this document accepted that Cloudflare would deploy every
push, green or red, and that `tests.yml` would stop gating officers. **That was
reversed on 2026-08-13**, before cutover, and the reason is recent: in one week
V2 shipped a viewer who could type into a legal record's Kad Rekod, and a print
threshold that erased signatures. Both were written with every suite green, and
both were caught by a person. A gate does not catch everything — it catches
what the suites already know, which is why they exist.

So `.github/workflows/release-gate.yml` runs the 28 suites on every push to
`main` and fast-forwards **`release`** only when they all pass. Cloudflare Pages
watches `release`. A red suite never reaches the branch that is built, and
officers keep the last good build until someone fixes it.

`scripts/verify-bundle.js` still runs inside the Cloudflare build and fails the
deployment on a bad *artefact* — no harness page, no CDN origin,
`script-src 'self'`, the Leaflet stylesheets present, the artwork present. The
two are complementary: the release gate catches logic, `verify-bundle` catches
the build.

The promotion is a **fast-forward**, never a force push. If `release` has
diverged someone pushed to it by hand, and that must fail loudly rather than
have its work discarded silently.

---

## 3. What had to change in the code first

Defects that only appear once Cloudflare builds this repo, all found while
planning rather than in production.

**An asset that lives only in the site repo will not ship.** This first bit
`login-bg.jpg`, which existed only in `e-pili-bomba` and was copied separately.
That file is **gone now** — the login gate is a near-white page with the
50th-anniversary watermark — but the rule it taught stands: anything the app
references must be in `v2/public/`, so Vite emits it to the site root. Today
that is `logo-50.png` and `percut19_generated.jpg`, and `verify-bundle.js`
fails the deployment if either is missing.

**And URLs must be root-absolute.** The built stylesheet is
`/assets/style-*.css`, and a relative `url()` resolves against the *stylesheet*
— so `url("logo-50.png")` requests `/assets/logo-50.png` and 404s. Every
artwork URL is written `url("/logo-50.png")`, and `verify-bundle.js` checks it.

Both fail **silently**: whatever declares the image declares a colour too, so a
missing file degrades to a plain panel that looks deliberate. Guarded three ways
— two checks in `verify-bundle.js` (file present, URL root-absolute) and
`tests/v2-app-live.js` **T9**, which loads each image and asserts its natural
dimensions. T9 deliberately does *not* assert
`getComputedStyle().backgroundImage`: that string is identical whether or not
the file exists, so it passes on both bugs.

**`X-Robots-Tag` is branch-aware.** Staging and production build the same
`v2/public/_headers`, but staging must stay `noindex` and production must not.
`scripts/finalize-headers.js` runs after `vite build`: on the production branch
it strips the line, otherwise it asserts the line is present. The source file
**keeps** the line deliberately — the safe default has to be what you get by
doing nothing, so any future branch or preview is private unless told otherwise.

> ### ⚠ `EPB_PRODUCTION_BRANCH` is REQUIRED on every Cloudflare project
>
> Both scripts derive production from
> `CF_PAGES_BRANCH === (EPB_PRODUCTION_BRANCH || 'main')`. Pages now watches
> **`release`**, so without that variable the build computes
> `release !== 'main'`, decides it is not production, and keeps
> `X-Robots-Tag: noindex` — on epilibomba.com.
>
> **The usual double-check cannot see this.** `verify-bundle.js` reads the same
> variable and reaches the same wrong answer, so all checks pass. Reproduced:
> 20 of 20 green while production shipped `noindex`. The site is live, correct,
> and invisible to every search engine, and nothing reports it.
>
> Both scripts now **refuse to guess**: if `CF_PAGES_BRANCH` is set and
> `EPB_PRODUCTION_BRANCH` is not, the build fails with instructions. Set it to
> `release` on **both** the production and the staging project — the same value
> on each; staging is simply not that branch. Local and CI runs set no
> `CF_PAGES_BRANCH` and are unaffected.

## 4. The cutover

1. **Merge `claude/epb-v2` into `main`.** Nothing unrelated in the merge.
   `main` keeps V1's `index.html`, `_headers` and `vendor/` untouched — the
   Pages build only reads `dist/`, and those files are what keeps the V1
   fallback current.

2. **Create the production Pages project.** *Pages*, not Workers — see
   `docs/STAGING.md` §1, which has the screenshot-level detail and the failure
   mode if you pick wrong.

   | Field | Value |
   |---|---|
   | Repository | `ibrahimismail-IM33/claude_code` |
   | Production branch | **`release`** — not `main`; see §2 |
   | Build command | `npm ci && npx vite build && node scripts/finalize-headers.js && node scripts/verify-bundle.js` |
   | Build output directory | `dist` |
   | Root directory | *(blank)* |

   Environment variables: `NODE_VERSION=20`,
   `PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1` (without it `npm ci` downloads ~150 MB
   of Chromium for a devDependency only the suites use), and
   **`EPB_PRODUCTION_BRANCH=release`** — required, and §3 explains what happens
   without it. The build now fails outright if it is missing, so a forgotten
   variable costs a failed deployment rather than a silently unindexed site.

   **The staging project needs `EPB_PRODUCTION_BRANCH=release` too**, the same
   value. Set it there BEFORE this change reaches staging, or staging's next
   build fails — loudly and harmlessly, but it fails.

   **Preview deployments OFF.** Six merged phase branches are still on origin;
   with previews on, each gets a live URL **writing to the production
   database**.

3. **Verify on the `*.pages.dev` URL, before the domain moves.** No officer is
   affected yet, and this is the cheapest moment to find anything.

   - The **login gate** appears — **with its background photograph**. A plain
     dark panel means §3 regressed.
   - **Response headers** (devtools → Network → the document → Response
     Headers): `Content-Security-Policy` with `script-src 'self'` and **no**
     `'unsafe-inline'`; `Permissions-Policy` with `geolocation=(self)`; and
     **no `X-Robots-Tag`**.
   - The **map** is a continuous tile grid on first load (`CLAUDE.md` §4.17).
   - **Dashboard** figures are non-zero and reconcile to the register.
   - **Guna Lokasi Saya** prompts for location — nothing else surfaces a broken
     `Permissions-Policy`.
   - The build log reads the commit you expect. Staging silently served a commit
     **six behind** for days; `docs/STAGING.md` §1 step 5c is that story.

4. **Move the custom domain.** Remove `epilibomba.com` from the old Pages
   project, then add it to the new one — Cloudflare will not let two projects
   hold one hostname, so there is a short window with the domain detached. Do it
   at a quiet hour.

5. **Re-verify on epilibomba.com, and print one Kad Rekod from it.** Different
   host, different build. The printout is cheap and it is the check that has
   actually caught things — three print defects, three found on paper, none
   found by any other means.

---

## 5. Rollback

**Move the domain back to the old Pages project.** No build, no revert, no
deploy — the site repo still holds V1 exactly as officers used it.

That is faster and less error-prone than a git revert, and it is the reason
§6 says to leave things alone.

---

## 6. Do not delete these

- **The old Pages project**, **the `e-pili-bomba` repo**, and
  **`publish-to-site.yml`**. The workflow keeps pushing V1 to the site repo on
  changes to the V1 paths, so the fallback stays current. All three together are
  the rollback in §5.
- **V1's `index.html`, `_headers` and `vendor/` in `main`.** Untouched by the
  migration and untouched by cutover. Cutover changes what is *published*, not
  what exists.

---

## 7. The test gate — done, not optional

This section used to describe taking the gate back as an optional extra. It was
**built before cutover instead** — see §2. `.github/workflows/release-gate.yml`
reuses `tests.yml` through `workflow_call`, so there is one definition of how
the suites run and the gate cannot drift from what it gates, and
`tests/suite-wiring.js` asserts the dependency plus that the promotion never
force-pushes.

Rollback gains a second form with it: reset `release` to the previous commit and
let Cloudflare rebuild.

## 8. Still open, not blocking

- ~~The register showed 203 pili where the notes said 188.~~ **Closed
  2026-08-09.** An officer added 15 pili with Tambah Pili on 2026-08-08 —
  ordinary field use. Verified read-only against production: 203 = 186 Awam +
  17 Swasta (matching the dashboard), **no duplicate labels**, all five zones
  contiguous (A 114 / B 27 / C 36 / D 13 / E 13), no label without a letter
  prefix, no missing coordinates or blank locations. Nothing to fix.
- **Six merged phase branches** remain on origin (`claude/epb-v2-p0-seams` …
  `-p5-kad`). Harmless while preview deployments are off.
- **`docs/STAGING.md` §5** points here for the cutover procedure.
