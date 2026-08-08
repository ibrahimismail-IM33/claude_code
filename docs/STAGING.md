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

1. **Workers & Pages → Create → Pages → Connect to Git.**
   Authorise the Cloudflare GitHub App for `ibrahimismail-IM33/claude_code`.
   This is a click-through authorisation, not a token you generate.

2. Name the project **`epilibomba-staging`**.
   It must be a **new project**, separate from whatever serves epilibomba.com.
   That separation is the only thing guaranteeing staging can never reach
   officers' live app.

3. **Production branch: `claude/epb-v2`.**
   Setting the branch as *production* is what gives the stable
   `epilibomba-staging.pages.dev` address. Any other branch produces preview
   deployments on per-commit URLs, and an address that changes is an address
   officers cannot be given.

4. **Build settings:**

   | Field | Value |
   |---|---|
   | Framework preset | None |
   | Build command | `npm ci && npx vite build && node scripts/verify-bundle.js` |
   | Build output directory | `dist` |
   | Root directory | *(leave blank — the repo root)* |

   Environment variable: **`NODE_VERSION` = `20`** (`package.json` requires
   `>=20`).

5. Deploy. Open the URL — **you must get the login gate.** That is the
   end-to-end proof. A page that loads but shows an empty map means the sign-in
   or RLS is the problem, not the hosting: an unauthenticated visitor is
   returned nothing by `select ... to authenticated`.

---

## 2. What `verify-bundle.js` is, and what it is not

`scripts/verify-bundle.js` runs as the last step of the build command. **A
non-zero exit fails the Cloudflare deployment and the previous version stays
up**, so it is a real gate, not a report. It checks ten properties of the
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

Verified by mutation before being trusted: a `V2_HARNESS=1` build, a missing
`_headers`, and a CDN string planted in an asset each produce exit code 1.

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

- **The Kad Rekod cannot be signed from staging.** Signature capture and
  signed-link resolution are still to be ported. Existing signatures on a card
  may not display.
- **The dashboard reports every hydrant as *Belum diperiksa*.** The Pengujian
  scan is still Phase 5 work. Honest zeros were chosen over guessed figures —
  a wrong number on a dashboard is worse than an obvious gap.

So staging is for: the map, place search, the zone panel, the Awam/Swasta
pills, the registry, adding a hydrant, and **the offline round trip** —
aeroplane mode, edit, park, reconnect, confirm from a second device. That last
one is the checklist that has caught every field bug so far.

---

## 5. At cutover

- Remove **`X-Robots-Tag: noindex`** from `v2/public/_headers`. Nothing else in
  that file changes — `tests/v2-csp.js` asserts that the staging and production
  policies differ in `script-src` alone, so any other drift fails there.
- The staging Pages project can stay. It costs nothing and is where the next
  change gets tried.
- Cutover itself is one merge of `claude/epb-v2` to `main`; rollback is one
  revert of that merge. Keep it that way by never mixing an unrelated change
  into the cutover commit.

---

## 6. If it did not deploy

| Symptom | Cause |
|---|---|
| Build fails at `verify-bundle.js` | Read the `FAIL` lines — they name the property. A harness page means the build ran with `V2_HARNESS=1` |
| Build fails at `npm ci` | `NODE_VERSION` is not set to 20 |
| `dist/_headers is missing` | `v2/public/_headers` was moved or deleted; Vite copies `v2/public/` into `dist/` |
| Deploys, but the page is blank | Check the browser console for a CSP violation. `tests/v2-csp.js` boots the real bundle under this exact policy, so a violation here means the policy changed and that suite was not re-run |
| Deploys, but the map is empty | Not a hosting problem. RLS returns nothing to an unauthenticated visitor — sign in |
| Nothing deploys on push | The Pages project is watching a different branch than `claude/epb-v2` |
