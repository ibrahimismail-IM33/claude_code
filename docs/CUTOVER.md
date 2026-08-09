# V2 cutover — putting the V2 bundle on epilibomba.com

The ordered checklist, with the rollback. Read §2 before doing anything: the
route chosen here changes what gates a release, and that is a decision worth
understanding rather than discovering.

**Status:** both mandatory gates are passed. The Kad Rekod **printed correctly
from V2 on a real printer** (2026-08-09), and staging has been used against the
production database. What remains is delivery.

---

## 1. How epilibomba.com is served — before and after

**Today.** `publish-to-site.yml` copies three paths — `index.html`, `_headers`,
`vendor/` — from `main` into a second repo, `ibrahimismail-IM33/e-pili-bomba`,
and Cloudflare Pages serves that repo's root as static files. Those three paths
are V1. It cannot publish V2: there is no build step, V2's app is a Vite bundle
under `v2/`, and the workflow's own guard requires `vendor/leaflet.js` and
friends that a V2 `dist/` does not contain.

Worth knowing, because it is the trap: merging `claude/epb-v2` into `main`
**does** fire that workflow (via a change under `vendor/**`), the suites pass,
it publishes, and the run goes **green** — having copied V1's unchanged
`index.html`. A successful publish is exactly the signal someone reads as
"cutover done", while officers are still on V1.

**After.** A Cloudflare Pages project builds `claude_code` directly and serves
`dist/`, exactly as staging does. The site repo stops being the source for
epilibomba.com and becomes the rollback target.

---

## 2. ⚠ What this route costs: `tests.yml` no longer gates officers

`publish-to-site.yml` cannot publish until the 26 suites pass (`needs: test`).
`CLAUDE.md` §3 records why that gate, not the workflow, was the deliverable.

**Cloudflare deploys every push to the production branch, green or red.**
`scripts/verify-bundle.js` runs in the build command and a non-zero exit fails
the deployment, so a bad *artefact* still cannot ship — no harness page, no CDN
origin, `script-src 'self'`, the Leaflet stylesheets present, the login
background present. **A logic regression can.** If Actions is red, assume
production is carrying it.

This was chosen knowingly. §7 is the way to take the gate back if it is wanted
later.

---

## 3. What had to change in the code first

Two defects that only appear once Cloudflare builds this repo, both found while
planning rather than in production:

**`login-bg.jpg` was not in this repository.** It existed only in the site repo,
copied separately. Now in `v2/public/`, so Vite emits it to the site root.

**And its URL had to become root-absolute.** The built stylesheet is
`/assets/style-*.css`, and a relative `url()` resolves against the *stylesheet*
— so `url("login-bg.jpg")` requests `/assets/login-bg.jpg` and 404s. It is now
`url("/login-bg.jpg")` in `shell.css` and `kad-rekod.css`.

Both fail **silently**: `#authGate` declares `#0a0b0d` as well, so a missing
image degrades to a dark panel that looks deliberate. Guarded three ways — two
checks in `verify-bundle.js` (file present, URL root-absolute) and
`tests/v2-app-live.js` **T9**, which loads the image and asserts its natural
dimensions. T9 deliberately does *not* assert `getComputedStyle().backgroundImage`:
that string is identical whether or not the file exists, so it passes on both
bugs.

**`X-Robots-Tag` is now branch-aware.** Staging and production build the same
`v2/public/_headers`, but staging must stay `noindex` and production must not.
`scripts/finalize-headers.js` runs after `vite build`: on the production branch
it strips the line, otherwise it asserts the line is present.

The source file **keeps** the line, deliberately — the safe default has to be
what you get by doing nothing, so any future branch or preview is private
unless told otherwise. Production is identified by `CF_PAGES_BRANCH`, which
Cloudflare sets on every build, so there is no dashboard variable to forget.
`verify-bundle.js` then re-checks the result independently: `finalize-headers`
decides, `verify-bundle` refuses to ship the wrong answer. Both directions are
mutation-verified.

---

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
   | Production branch | `main` |
   | Build command | `npm ci && npx vite build && node scripts/finalize-headers.js && node scripts/verify-bundle.js` |
   | Build output directory | `dist` |
   | Root directory | *(blank)* |

   Environment variables: `NODE_VERSION=20` and
   `PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1` (without it `npm ci` downloads ~150 MB
   of Chromium for a devDependency only the suites use).

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

## 7. Optional: take the test gate back

Point the production project at a **`release`** branch rather than `main`, and
add a workflow that fast-forwards `release` to `main` only when `tests.yml`
passes. Cloudflare still builds directly and nothing else changes; a red suite
simply never reaches the branch it builds. Rollback gains a second form:
resetting `release` to the previous commit.

Worth doing if V2 is going to see regular changes. Not required for cutover.

---

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
