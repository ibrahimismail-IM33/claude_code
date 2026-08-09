# V2 staging — setup and operating rules

Staging exists so officers meet V2 **before** cutover rather than on the day.
Every serious defect this app has had — §4.10 (offline data destroyed), §4.13
(a row that could never be cleared), and three print defects — was found by a
person *using* the thing. None was found by review. Staging is how that
feedback arrives early.

**URL:** `https://epilibomba-staging.pages.dev`
**Serves:** the `claude/epb-v2` branch of `ibrahimismail-IM33/claude_code`
**Database:** the **same** Supabase project as production — see the warning below.

---

## 1. One-time setup, in the Cloudflare dashboard

No API token and no secret is needed. Cloudflare builds the branch itself.

> **Connect to Git, NOT Direct Upload.** Direct Upload was the earlier plan and
> was rejected: it means a machine *pushes* the built files to Cloudflare, which
> needs a `CLOUDFLARE_API_TOKEN`, an account ID stored as a repository secret,
> and `wrangler` in a workflow. Connect to Git means Cloudflare *pulls* the repo
> and builds it, and the whole point of this route is that **no secret has to be
> created at all**. The two are opposite mechanisms and a project created as
> Direct Upload cannot be converted — if one exists, delete it and start again.

1. **Workers & Pages → Create → the PAGES tab → Connect to Git.**
   Authorise the Cloudflare GitHub App for `ibrahimismail-IM33/claude_code`.
   This is a click-through authorisation, not a token you generate.

   > ### ⚠ Pick **Pages**, not Workers. They are different products.
   >
   > The Create button defaults to **Workers**, and Cloudflare has pushed Pages
   > into a secondary tab. Choosing the default silently gives you a Worker,
   > which **ignores the Build output directory below** — it has no such
   > setting — and instead tries to upload the entire repository as its assets.
   > That fails with a misleading error:
   >
   > ```
   > ✗ [ERROR] Asset too large.
   >   Read 2085 files from the assets directory /opt/buildhome/repo
   > ```
   >
   > 2085 files is the whole repo including `node_modules`. `dist` is about ten
   > files and 632 KB. **The size error is a symptom; the disease is the wrong
   > product.**
   >
   > Two seconds to check what you actually created:
   >
   > | | Pages — correct | Worker — wrong |
   > |---|---|---|
   > | URL | `dash.cloudflare.com/…/**pages**/view/…` | `…/**workers/services**/view/…` |
   > | Tabs | Deployments, Custom domains | **Bindings**, **Observability** |
   >
   > If a Worker already exists under this name, **delete it first** — the name
   > cannot be reused while it is there.

2. **On the "Set up builds and deployments" screen, these three are the ones
   that go wrong.** Cloudflare asks for the repository, the project name and
   the production branch on one page:

   | Field | Value | Why it matters |
   |---|---|---|
   | Repository | **`ibrahimismail-IM33/claude_code`** | The **only** repo with the V2 app, `vite.config.mjs`, `scripts/verify-bundle.js` and the suites. Any other copy is a fork that will drift |
   | Project name | `epilibomba-staging` | Gives `epilibomba-staging.pages.dev`. Cosmetic, but keep it matching this doc |
   | Production branch | **`claude/epb-v2`** | `main` is V1 and has **no `v2/` and no `vite.config.mjs`** — it would build nothing. Setting this branch as *production* is also what gives a stable URL rather than per-commit preview addresses |

   > ### ⚠ Do not point this at a copy of the source
   >
   > If a repo like `epilibomba-v2` or `epilibomba-staging` exists holding an
   > exported copy of `v2/`, **do not use it.** Such a copy typically has no
   > `vite.config.mjs`, no `scripts/`, and a `package.json` with no
   > dependencies, so it cannot build at all — and even if it could, it is a
   > second source of truth. `CLAUDE.md` §3 records what that costs: this
   > project already had two repos drift **7 commits apart**, and officers ran
   > a live app missing fixes. There is one source of truth and it is
   > `claude_code`.

   The project must also be a **new** project, separate from whatever serves
   epilibomba.com. That separation is the only thing guaranteeing staging can
   never reach officers' live app.

3. **Build settings:**

   | Field | Value |
   |---|---|
   | Framework preset | None |
   | Build command | `npm ci && npx vite build && node scripts/verify-bundle.js` |
   | Build output directory | `dist` |
   | Root directory | *(leave blank — the repo root)* |

   Environment variables — **both are required**:

   | Name | Value | Why |
   |---|---|---|
   | `NODE_VERSION` | `20` | `package.json` requires `>=20` |
   | `PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD` | `1` | `playwright` is a devDependency and `npm ci` runs its postinstall, which downloads **~150 MB of Chromium** that only the test suites use. Nothing on Cloudflare's builder suppresses it — this container only avoids it because `PLAYWRIGHT_BROWSERS_PATH` happens to be set here. Without this the build is slow at best, and can fail on Cloudflare's 25 MiB per-file limit |

4. **Settings → Builds & deployments → Preview branch control → turn preview
   deployments OFF** (or restrict them to none), so **only `claude/epb-v2`
   deploys.**

   This is not tidiness. Cloudflare builds *every* branch by default, so each
   push to `claude/epb-v2-p5-kad` or any future phase branch would put a live
   URL online — and **every one of those writes to the production Supabase
   project** (§3). One staging URL against the real register is an accepted
   risk; one per branch is not, and nobody would have chosen it.

5. Deploy, then check **two** things — the second is the one people skip.

   **a. Open the URL — you must get the login gate.** A page that loads but
   shows an empty map means the sign-in or RLS is the problem, not the hosting:
   an unauthenticated visitor is returned nothing by
   `select ... to authenticated`.

   **b. Confirm `_headers` actually applied.** Devtools → Network → click the
   document request → Response Headers. Both of these must be present:

   - `Content-Security-Policy: … script-src 'self' …`
   - `Permissions-Policy: … geolocation=(self) …`

   The gate appearing proves the bundle runs. It proves **nothing** about the
   headers — `_headers` is a separate mechanism and it either applied or it did
   not. A missing `Permissions-Policy` is invisible until an officer stands
   beside a hydrant, taps **Guna Lokasi Saya**, and nothing happens. A missing
   CSP loses the security posture the whole self-hosting decision was for.

   Also glance at the build log: it should read roughly **"Read 10 files"**. If
   it says thousands, it is a Worker — see the warning in step 1.

   **c. Check WHICH COMMIT it built.** The log's third line names it
   (`HEAD is now at <sha>`). This is not paranoia: on 2026-08-09 staging was
   found serving a commit **six behind** the branch, and had been for days.
   Nothing about the site said so — it loaded, it signed in, it showed a
   dashboard. The figures on that dashboard were a **stub reading all zeros**,
   and they were read as real. A stale staging build is worse than a broken
   one, because a broken one announces itself. **Every time staging is used to
   confirm something, confirm the commit first.**

---

## 2. What `verify-bundle.js` is, and what it is not

`scripts/verify-bundle.js` runs as the last step of the build command. **A
non-zero exit fails the Cloudflare deployment and the previous version stays
up**, so it is a real gate, not a report. It checks these properties of the
artefact:

- `index.html` and `_headers` are present — without `_headers` the CSP, the
  `noindex` and `geolocation=(self)` are all silently absent
- `script-src` is `'self'` alone, with no `'unsafe-inline'`
- `X-Robots-Tag: noindex` is set
- `geolocation=(self)` is set — losing it disables "Guna Lokasi Saya" with **no
  error message at all**
- no `harness.html` and no `harness-*` bundle
- no `sql/`, no `tests/`
- no CDN origin anywhere in the built JS/CSS/HTML
- the built CSS carries Leaflet's and markercluster's own rules — without them
  the map renders as scattered tiles with black gaps from first paint, and
  nothing else in the pipeline notices (CLAUDE.md §4.17)

Verified by mutation before being trusted: a `V2_HARNESS=1` build, a missing
`_headers`, a CDN string planted in an asset, and a dropped Leaflet stylesheet
import each produce exit code 1.

### What it deliberately does not do

**It does not run the test suites, and the suites do not gate this deploy.**
That was a deliberate trade for simplicity — Cloudflare deploys every push to
`claude/epb-v2` whether `tests.yml` is green or red. `tests.yml` still runs on
every push, so a failure is visible in GitHub Actions; it is just visible
*after* the deploy rather than instead of it.

In practice: **a bad bundle will not reach staging, but a logic regression
will.** If Actions goes red, assume staging is carrying the regression until
it is fixed.

---

## 3. ⚠ Staging writes to the PRODUCTION database

There is one Supabase project (`isxfhocfkjamjchmicwq`) and staging points at
it. That is deliberate — it is what makes staging worth testing on, since the
data and the logins are real — but it means:

- **Every save made on staging is a real save.** Adding a hydrant, editing a
  Kad Rekod row or clearing one changes the actual register.
- **Signed rows are still permanent**, enforced by RLS and by a database
  trigger regardless of which build the request came from.
- Anyone testing must be told this before they touch it.

Combined with §2 — the suites do not gate the deploy — this is the accepted
risk of the current setup. It is written down here so it is a known trade
rather than a surprise.

---

## 4. What to tell officers, up front

Staging is **not** anyone's daily driver. Real inspections still go through
epilibomba.com. Two things are genuinely missing, and saying so first avoids
bug reports for known gaps:

- **Signing a row on staging is REAL and PERMANENT.** Signature capture is now
  wired, and it writes to the production database like everything else here.
  A row signed while "just testing" can never be edited, cleared or deleted —
  by anyone, including an admin. Tell whoever tries staging this before they
  tap **+ T.T**.

So staging is for: the map, place search, the zone panel, the Awam/Swasta
pills, the registry, adding a hydrant, and **the offline round trip** —
aeroplane mode, edit, park, reconnect, confirm from a second device. That last
one is the checklist that has caught every field bug so far.

---

## 5. At cutover

**See `docs/CUTOVER.md` — it is the ordered checklist.**

This section used to say cutover was "one merge of `claude/epb-v2` to `main`".
**That was wrong.** `publish-to-site.yml` copies `index.html`, `_headers` and
`vendor/` verbatim with no build step, and V2's app is none of those — it is a
Vite bundle built from `v2/`. The merge does fire the workflow (via a change
under `vendor/**`) and it does go green; what it publishes is V1's
`index.html`, unchanged. So officers stay on V1 while the merge, the suites,
the publish run and a fresh commit in the site repo all report success. The
publish pipeline has to be taught to build V2 *before* the merge happens.

Two things here remain true and are repeated in `CUTOVER.md`:

- Remove **`X-Robots-Tag: noindex`** from `v2/public/_headers`. Nothing else in
  that file changes — `tests/v2-csp.js` asserts that the staging and production
  policies differ in `script-src` alone, so any other drift fails there. Note
  that `scripts/verify-bundle.js` currently *requires* that line, so it needs
  to become environment-aware in the same change or the build fails.
- The staging Pages project can stay. It costs nothing and is where the next
  change gets tried.

---

## 6. If it did not deploy

| Symptom | Cause |
|---|---|
| `[ERROR] Asset too large` **and** `Read 2085 files from the assets directory /opt/buildhome/repo` | **It is a Worker, not a Pages project.** It is uploading the whole repo instead of `dist`, so it hits `node_modules`. The size error is the symptom, not the disease — delete it and create a **Pages** project (step 1) |
| Build is slow, or fails on a file over 25 MiB | `PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1` is not set, so `npm ci` is downloading ~150 MB of Chromium for a devDependency only the tests use |
| Deployed, but no `Content-Security-Policy` or `Permissions-Policy` on the response | `_headers` did not apply. Check `dist/_headers` exists in the build log output, and that this is a Pages project — the header mechanism differs between products |
| Build fails at `verify-bundle.js` | Read the `FAIL` lines — they name the property. A harness page means the build ran with `V2_HARNESS=1` |
| Build fails at `npm ci` | `NODE_VERSION` is not set to 20 |
| `dist/_headers is missing` | `v2/public/_headers` was moved or deleted; Vite copies `v2/public/` into `dist/` |
| Deploys, but the page is blank | Check the browser console for a CSP violation. `tests/v2-csp.js` boots the real bundle under this exact policy, so a violation here means the policy changed and that suite was not re-run |
| Deploys, but the map is empty | Not a hosting problem. RLS returns nothing to an unauthenticated visitor — sign in |
| Nothing deploys on push | The Pages project is watching a different branch than `claude/epb-v2` |
| **Staging is serving an OLD commit and "Retry deployment" keeps rebuilding it** | Cloudflare never received the newer pushes, so there is no newer deployment to run — and **Retry replays the same commit by design**, so it can never escape this. Happened 2026-08-09: staging sat **six commits behind** for days while every push looked successful from this end. Check **Settings → Builds & deployments → Branch control**: if the **production branch** is not `claude/epb-v2` *and* preview deployments are off (step 4), every push is classified as a preview and silently dropped. Otherwise the GitHub App has lost access — reconnect it and confirm `claude_code` is in its selected repositories. To recover immediately use **Create deployment**, not Retry |
