# epilibomba (e-Pili Bomba) — Build Spec

> Compiled from the design conversation. This document captures what the app is,
> the decisions made so far, and what remains open, so we can continue building
> from a single source of truth.

## What it is

**epilibomba** (e-Pili Bomba Kunak) is a fire-hydrant (pili bomba) map and
inspection-record app for **BBP Kunak, Sabah** (JBPM). Field officers use it —
on a phone, in the field, sometimes wearing gloves — to locate hydrants, filter
by category/status, add hydrants, and maintain the Kad Rekod Pili Bomba.

- **Actual shipped stack:** a single self-contained `index.html` (vanilla JS, no
  build step) — Leaflet 1.9.4 + markercluster + OpenStreetMap tiles for the map,
  **Supabase** (Postgres + Auth + Storage, project `isxfhocfkjamjchmicwq`) for
  data, CDN with unpkg → jsdelivr fallback. Deployed on a static host with a
  Cloudflare `_headers` file for CSP/HSTS/Permissions-Policy.
- **Note on the React draft below:** the dashboard/donut work described further
  down came from an earlier React + Tailwind exploration. The live app is the
  single-file `index.html`; treat the React notes as design intent to port, not
  as the current codebase.
- **Language of the UI:** Bahasa Malaysia (e.g. *Pili Bomba*, *Jadual Pemeriksaan*,
  *Tambah Pili Baru*, *Lihat semua*, *Diperiksa* / *Belum diperiksa*).

## Backend (in repo under `sql/`)

- **`profiles`** — one row per login; role `admin` | `viewer` (default `viewer`).
  `is_admin()` helper drives every RLS rule. Any signed-in user reads; only admin
  writes.
- **`hydrants`** — 187 seeded rows (170 Awam `kerajaan` + 17 Swasta `swasta`:
  A26, A92–A107 at Kilang T.S.H Wilmar). Columns: id, label, lat, lng, status,
  location.
- **`hydrant_records`** — one row per line of a record card, keyed
  (hydrant_id, section, row_index); sections: header / kerosakan / pemantauan /
  pengujian / kompaun; `data` is JSONB.
- **Permanent signing:** once `signed = true`, a row can never be edited/deleted —
  enforced by both an RLS policy (`signed = false` predicate) and an independent
  `protect_signed_rows` trigger. Signature images live in a public `signatures`
  storage bucket, upload-only (no update/delete policy).

## Core screens / features

### 1. Map (main view)
- Interactive map of fire hydrants (near-black dark base, red accents, JBPM logo).
- Hydrants can be filtered (e.g. by clicking dashboard donut labels, or by
  searching a location).

### 2. Cards (on the app home)
- **Registry card** — headline count of hydrants, status bars.
- **Tambah Pili Baru card** — entry point to the "add hydrant" form.
  - The Add form itself holds latitude/longitude example values.
- Both were redesigned to be **more compact** (see Changelog).

### 3. Dashboard (Draft v2)
- **Donut chart** of inspection status:
  - **Flat** donut (not 3D — tilted 3D distorts proportion reading, bad for a
    compliance figure shown to a state officer).
  - Rendered in the reference's **brighter, gradient style**, but keeping the
    app's **meaning-based palette**: green / amber / grey for the three statuses
    (*Diperiksa*, in-progress, *Belum diperiksa*). Reference's decorative
    pink/purple/cyan was rejected because it strips status meaning.
  - **Leader lines with dots** connecting each segment to its label.
  - Labels are **clickable → filter the map**.
- **Background:** a **subtle blue lift** over the app's existing dark base — NOT a
  separate navy theme — so the dashboard and map still feel like one product.

### 4. Jadual Pemeriksaan (inspection schedule table)
- Columns: **Tarikh / Pasukan / Lokasi** (the `No. Pili` column was dropped).
- **Lokasi** links act as a **map search** — tapping a location filters the map to
  all hydrants at that place (since without a hydrant number one location can map
  to several hydrants).
- Shows **5 rows** with a **"Lihat semua"** control to expand to the full list.
- (Second table also shows 5 rows, filtered to latest.)

## The five locked design decisions

1. **Blue background:** subtle version (a blue lift over the dark base), app-wide feel preserved.
2. **Segment colours:** keep green/amber/grey, rendered in the reference's brighter gradient style.
3. **3D look:** flat donut.
4. **Lokasi → map:** behaves like a search (filters map to all hydrants at that place).
5. **Row limit:** 5 rows with a **"Lihat semua"** expander.

## Accessibility / field-use fixes applied to Draft v2

Audited against the UI/UX skill's priority table; 9 issues found and fixed:

- **Touch targets:** pills, buttons, delete control raised from 22–36px to **≥44×44px**
  (field use, gloves). Inputs use **16px** text so iOS doesn't zoom on focus.
- **No horizontal scroll on phones:** chart was a fixed 720px → now **scales to viewport**.
- **Contrast:** three text colours were below 4.5:1 on the new blue bg → all now
  **pass ≥4.5:1**, verified by calculation (incl. `--dim2` hint text and delete icon).
- **Delete icon:** emoji `✕` → proper **SVG with `aria-label`**.
- **Form errors:** floating toast → **inline errors beside fields**, invalid fields
  marked, focus moved to the first empty field.
- Also added: **reduced-motion** support, **focus rings**, and **keyboard access**
  for the Lokasi links.

## Open questions (to resolve before integrating the dashboard)

1. **Supabase for the Jadual:** should the inspection schedule save to Supabase so
   everyone sees the same plan (shared state), rather than being local?
2. **Archive on period reset:** when a reporting period resets, should archives keep
   the **full hydrant list**, or just the **totals**?
3. **Jadual sort semantics:** the "5 rows, filter latest" schedule — show the 5
   **soonest-upcoming** inspections (recommended for a schedule) or the 5 **most
   recently added**? (Leaning soonest-upcoming; needs confirmation.)

## Changelog (from the conversation)

- **Registry card** made compact: container 250px → 208px, padding `p-4` → `p-3`,
  headline `text-4xl` → `text-3xl`, thinner status bars, reduced vertical spacing.
- **Tambah Pili Baru card** made compact: reduced padding, smaller icon/title,
  condensed helper text, slimmer "Open Add Form" button, and **removed the two
  lat/long example boxes** (the example values still live in the actual Add form).
- Pre-existing build noise noted (missing `node` types, deprecated `baseUrl`) —
  unrelated to the edits.
- **Dashboard Draft v2** built with all five decisions + accessibility fixes.

## Notes / conventions

- Keep the palette **meaning-based** — colour carries status, not decoration.
- Keep the whole app feeling like **one product** (no jarring theme split between tabs).
- Optimise for **phone-in-the-field** use: large touch targets, no zoom-on-focus,
  no horizontal scroll, high contrast.
