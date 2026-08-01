# e-Pili Bomba Kunak

Interactive fire-hydrant (pili bomba) map and inspection-record app for
**BBP Kunak, Sabah** (Bahagian Bomba dan Penyelamat / JBPM).

Field officers use it — on a phone, in the field — to locate hydrants, filter by
category and inspection status, add new hydrants, and maintain the Kad Rekod Pili
Bomba (inspection record cards) with permanent, locked signatures.

## What's here

| Path | What it is |
|------|-----------|
| `index.html` | The entire app — a single self-contained page (Leaflet map + Supabase, loaded from CDN). |
| `_headers` | Cloudflare Pages security response headers (CSP, HSTS, Permissions-Policy). Deploy in the same folder as `index.html`. |
| `sql/supabase-setup.sql` | **Run first.** Accounts/roles (`profiles`, `is_admin()`) + the `hydrants` table seeded with all 187 Kunak hydrants. |
| `sql/supabase-records-setup.sql` | **Run second.** `hydrant_records`, the signatures storage bucket, and the permanent row-lock trigger. |
| `docs/epilibomba-spec.md` | Design spec / decisions / open questions. |

## Stack

- **Frontend:** one static `index.html`. Vanilla JS, no build step. Leaflet 1.9.4 +
  markercluster for the map, OpenStreetMap tiles, Bricolage Grotesque / DM Sans /
  JetBrains Mono fonts. CDN with unpkg → jsdelivr fallback.
- **Backend:** Supabase (Postgres + Auth + Storage), project
  `isxfhocfkjamjchmicwq`.
- **Hosting:** static host with `_headers` support (Cloudflare Pages).

## Data model (187 hydrants)

- 170 **Awam** (`status = 'kerajaan'`) + 17 **Swasta** (`status = 'swasta'`:
  A26 and A92–A107, all at Kilang T.S.H Wilmar).
- Labels are zoned: `A**` (Kunak town), `B**`, `C**`, `D**` (Madai), `E**` (Pangi).

## Security model

- Any signed-in user may **read**; only an **admin** may **write** (RLS enforced).
- New accounts default to `viewer`; promote manually:
  `update public.profiles set role='admin' where email='their@email.com';`
- **Signed record rows are permanent** — locked by both an RLS policy *and* an
  independent trigger; signature images cannot be replaced or deleted.
- `geolocation=(self)` in `_headers` is required by the "Guna Lokasi Saya" button.

## Deploy

1. Supabase → SQL Editor: run `sql/supabase-setup.sql`, then
   `sql/supabase-records-setup.sql` (both are safe to re-run).
2. Create user accounts (Authentication → Users → Add user, tick *Auto Confirm*),
   promote admins as above.
3. Publish `index.html` + `_headers` to the static host.
