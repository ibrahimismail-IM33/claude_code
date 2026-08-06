# Tests

The app is one static `index.html` with no build step, so these are plain
Node scripts that stand the real page up in Chromium, stub out the two
things that need network (Supabase and Leaflet), drive the actual UI, and
assert on what reaches the "server".

## Running

```sh
npm ci                       # once
npm test                     # all three suites
npm run test:offline         # or one at a time
npm run test:csp
npm run test:signatures
```

Chromium is found at `/opt/pw-browsers/chromium` by default; override with
`CHROMIUM_PATH=/path/to/chromium`.

Exit code is 0 when everything passes, 1 otherwise.

## CI

`.github/workflows/tests.yml` runs all three suites on **every push and pull
request**, and `publish-to-site.yml` calls the same workflow and will not
publish until it passes:

```yaml
jobs:
  test:
    uses: ./.github/workflows/tests.yml
  publish:
    needs: test
```

**That gate is the point.** A red suite stops the change reaching officers.
A CI workflow that reports a failure while the broken build ships anyway is
decoration — if you ever change these workflows, keep `workflow_call` in
`tests.yml` and `needs: test` in the publish job, or the gate detaches without
anything appearing to break.

CI asks Playwright for its own Chromium path rather than hardcoding one, so
bumping the `playwright` version in `package.json` needs no change here.

## What is here

| File | Guards |
|---|---|
| `p0-offline-sync.js` | Inspection data typed with no signal must survive and reach the server. This was a real, reproduced data-loss bug (2026-08-03) — a failed save was silently overwritten by the cloud copy the next time the card was opened. Also covers the conflict path, signed rows, auto-push on reconnect, and that ordinary online saves are unchanged. |
| `clear-row.js` | An officer must be able to withdraw a wrong entry. Found in the field 2026-08-04: clearing a row and saving did nothing, because an upsert never deletes the rows it is not sent — and the app had no `.delete()` on `hydrant_records` at all. Covers the online clear, signed rows staying untouchable, clearing offline, a contested removal, the map pin's date badge following the rows that remain, and that a **failed flush changes nothing** (it used to drop the parked work). |

| `csp-and-vendor.js` | The libraries stay self-hosted and the app still works under the tightened CSP. Serves the real files with the CSP parsed out of `_headers` and boots the app with the genuine Leaflet. Fails if a CDN tag is ever added back. |
| `signature-links.js` | Signature images resolve to short-lived signed links, and — critically — fall back to the stored value when signing is unavailable, so a signature never fails to display. Covers rows stored as legacy public URLs and as paths. |

## Adding to this

A test earns its place by **failing on the broken code**. Before committing
one, check out the version without your fix and confirm the test goes red —
otherwise it guards nothing.
