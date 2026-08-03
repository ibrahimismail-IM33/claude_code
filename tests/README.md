# Tests

The app is one static `index.html` with no build step, so these are plain
Node scripts that stand the real page up in Chromium, stub out the two
things that need network (Supabase and Leaflet), drive the actual UI, and
assert on what reaches the "server".

## Running

```sh
npm i -D playwright          # once
node tests/p0-offline-sync.js
```

Chromium is found at `/opt/pw-browsers/chromium` by default; override with
`CHROMIUM_PATH=/path/to/chromium`.

Exit code is 0 when everything passes, 1 otherwise.

## What is here

| File | Guards |
|---|---|
| `p0-offline-sync.js` | Inspection data typed with no signal must survive and reach the server. This was a real, reproduced data-loss bug (2026-08-03) — a failed save was silently overwritten by the cloud copy the next time the card was opened. Also covers the conflict path, signed rows, auto-push on reconnect, and that ordinary online saves are unchanged. |

## Adding to this

A test earns its place by **failing on the broken code**. Before committing
one, check out the version without your fix and confirm the test goes red —
otherwise it guards nothing.
