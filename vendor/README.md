# vendor/ — third-party libraries, served from this site

These are **not** loaded from a CDN. A script from unpkg or jsdelivr runs with
full access to the signed-in Supabase session and every record card, and
`@supabase/supabase-js@2` used to float — whatever the CDN considered "latest
2.x" reached every officer with no review step. Serving our own copies removes
that path and lets `_headers` keep `script-src 'self'`.

## What is here

| File | Package | Version |
|---|---|---|
| `leaflet.js`, `leaflet.css`, `images/*` | `leaflet` | **1.9.4** |
| `leaflet.markercluster.js`, `MarkerCluster.css`, `MarkerCluster.Default.css` | `leaflet.markercluster` | **1.5.3** |
| `supabase.js` | `@supabase/supabase-js` (dist/umd) | **2.112.0** |

`images/` is required by `leaflet.css`, which references it relatively.

## Provenance

Taken from the npm tarballs, not scraped from a CDN. Tarball checksums at the
time of vendoring:

```
leaflet@1.9.4                    sha512-nxS1ynzJOmOlHp+iL3FyWqK89GtNL8U8rvlMOsQdTTssxZwCXh8N2NB3GDQOL+YR3XnWyZAxwQixURb+FA74PA==
leaflet.markercluster@1.5.3      sha512-vPTw/Bndq7eQHjLBVlWpnGeLa3t+3zGiuM7fJwCkiMFq+nmRuG3RI3f7f4N4TDX7T4NpbAXpR2+NTRSEGfCSeA==
@supabase/supabase-js@2.112.0    sha512-dHVOgog58GOagtrZuPxJYg/R45ZV2U0qqgXffH+lMlt1OS+267Pw4g7bw3iXCGxN85OufiE0nI1baxDXlgEyfQ==
```

## Updating

```sh
npm pack <package>@<version>
tar xzf <tarball>
cp package/dist/<file> vendor/
```

Then bump the version in this table, run `node tests/csp-and-vendor.js`, and
re-publish. Do **not** point the tags in `index.html` back at a CDN.

## During the V2 migration, bump BOTH

V2 (`docs/V2-ROADMAP.md`) gets these same three libraries from npm instead of
from this folder, pinned in `package.json` to **the exact versions in the table
above**. They are held together on purpose: if the two drift, a defect found in
V2 could be the rewrite or could be a library bump, and no amount of reading the
diff separates those two.

`tests/v2-csp.js` parses the versions out of this table and compares them with
`package.json`, so updating one and forgetting the other fails the suite rather
than going unnoticed. Update the table and the pin in the same commit.
