# DOM contract

**These selectors are an interface, not implementation detail.** V2 (Vue) must
emit them exactly. Renaming one is a breaking change even when the app still
looks right.

## Why this file exists

The V2 migration (`docs/V2-ROADMAP.md`) rests on one guarantee:

> A migrated view is done when the existing suites pass **unchanged**. If a test
> needs editing to go green, that is a behaviour change, and behaviour changes
> are out of scope.

Those suites drive the real UI in a real browser, which is what makes them
framework-agnostic and therefore usable as the migration contract. But they find
things by the ids and classes V1 happens to emit. If Vue emits different markup,
every suite goes red at once for a reason that has nothing to do with a defect —
and the only safety net this app has is gone, at exactly the moment it is needed
most.

Rewriting the tests to match new markup would look like progress and would be
the opposite: a suite adjusted to fit the code it is testing has stopped being
evidence. Every entry below was verified present in V1's `index.html` at the
time of writing.

## The contract

### Shell, map and dashboard

| Selector | Used by | Meaning |
|---|---|---|
| `#authGate` | `p0-offline-sync`, `clear-row`, `kad-rekod` | Login gate overlay. Its removal is how the tests know the app is usable |
| `#tabDash` | `zone-panel` | The Dashboard tab button |
| `#dashView` | `zone-panel` | Dashboard root. **Also the CSS scope for every dashboard rule** (CLAUDE.md §10) |
| `#banner` | `zone-panel` | Active-filter banner; clicking it clears the filter |
| `#pills .pill[data-s=…]` | `zone-panel` | Awam/Swasta scope pills. `data-s` carries the status value |
| `#dashRecent` | `zone-panel` | "Pemeriksaan terkini" panel |
| `#dashZones` | `zone-panel` | "Nombor Pili Terkini" panel root |
| `#dashZones .zrow` | `zone-panel` | One zone row. **Buttons, never a table** — `#dashView table` carries `min-width:460px` and would push a phone sideways (§4.9) |
| `.zk` / `.zr` / `.zc` | `zone-panel` | Zone letter / range / count inside a `.zrow` |
| `#dashZoneNote` | `zone-panel` | Caption. Carries the unparsed-label count and any range/count disagreement — the two ways the panel could quietly lie |
| `#searchInput` | `v2-map-search-add`, and V1's `goMapSearch` | The place-search box. The dashboard writes into it directly, so it is an interface between two views |
| `#searchClear` | `v2-map-search-add` | The ✕. Carries `.hide` while the box is empty |
| `#searchResult` | `v2-map-search-add` | The result line. `.none` is the empty state and `.note` is the "pills ignored" explanation — **the note is not decoration**: without it a search and a pill silently disagree |
| `#hint` | `v2-map-search-add` | "Click anywhere on map to set lat / long". Shown only while adding |
| `#aLabel` / `#aLat` / `#aLng` / `#aInsp` | `v2-map-search-add` | Add-modal fields. `.bad` marks an out-of-range coordinate, `#aLatErr` / `#aLngErr` state the range |
| `#aGeo` / `#aGeoTxt` / `#aGeoMsg` | `v2-map-search-add` | "Guna Lokasi Saya" and its status line. Needs `geolocation=(self)` in `_headers` — nothing in the app can compensate for that header's absence |
| `#aSave` | `v2-map-search-add` | Add button. **Disabled until the label and both coordinates are valid**, and reads "Fill Lat/Long" until then |
| `.cls[data-s=…]` | `v2-map-search-add` | Classification buttons in the add modal. `.sel` marks the chosen one |
| `#dOpenForm` | `kad-rekod`, `clear-row` | "Kad Rekod" button in the hydrant detail modal |

### Kad Rekod

Read `docs/KAD-REKOD.md` before changing anything here. This is a mandatory
record under MS ISO PS-8 and several of these carry legal meaning.

| Selector | Used by | Meaning |
|---|---|---|
| `.fsheet` | `kad-rekod` | The stack of cards. Carries `flex-direction:column-reverse` on screen and `column` in print — **the newest-first/oldest-first split lives here, not in the render loop** |
| `.fcard` | `kad-rekod` | One Kad Rekod = **exactly two** `.fpage` |
| `.fpage` | `kad-rekod` | One printed page. `.pb` adds `page-break-before` |
| `.kadno` | `kad-rekod` | "Kad n/N". Permanent and chronological — oldest is always Kad 1 |
| `.terkini` | `kad-rekod` | Marks the newest card. **Hidden in print**; a screen affordance, not part of the record |
| `table.ftab` | `kad-rekod`, `clear-row` | A section table. Section class follows: `.ftab.pengujian`, `.ftab.kerosakan` |
| `input.fin` / `.fin-date` | `clear-row`, `p0-offline-sync` | A cell input; `.fin-date` is the Tarikh column |
| `tr.rowsigned` | `kad-rekod`, `clear-row` | A signed row. **Every input inside is disabled and stays that way** |
| `img.sigimg` | `kad-rekod`, `signature-links` | The signature image. Its print filter must stay **after** the screen rule in source order or it silently loses at equal specificity |
| `.sigbtn` | `kad-rekod` | Opens the signing popup |
| `#fSave` | all card suites | Save. Card growth is triggered here, before the save |
| `#fClose` | all card suites | Close the card |
| `#fPending` | `p0-offline-sync`, `clear-row` | Unsent-work banner. Its presence is how the tests detect parked offline work |
| `#sigFile` / `#sigOk` | `kad-rekod` | Signature file input and confirm |

## Rules

1. **Ids and classes above are renamed only with a deliberate decision**, and the
   suites are updated in the same commit with the reason in the message.
2. **Vue `scoped` styles are fine; Vue-generated class names are not.** Anything
   in this table must appear literally in the DOM, not as a hashed variant.
3. **`#dashView` stays the dashboard's CSS scope.** The app's CSS is global and
   `.card`, `.btn` and `.pill` are already taken (§5).
4. **Print-facing selectors carry no scoped styling.** The Kad Rekod print CSS
   moves as one plain global stylesheet, in source order.
5. If a V2 component genuinely needs different markup, **change V1 first**, let
   the suites confirm it, then migrate. Never both at once — otherwise a red test
   has two possible causes and neither can be ruled out.
