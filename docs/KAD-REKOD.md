# Kad Rekod Pili Bomba — specification

**This document is binding.** The Kad Rekod is a **mandatory** record. Its
layout, its capacities and the way it grows are not ours to redesign for
convenience, tidiness or a framework migration. If a change to the app would
alter what comes out of the printer, it needs the officer's approval first —
not a code review.

Guarded by `tests/kad-rekod.js` (41 assertions) and, for the printed
signature specifically, `tests/v2-signature-print-parity.js` — which runs V1's
implementation and V2's over the same fixtures and requires byte-identical
output. Implemented in `index.html`.

> ## MS ISO 9001:2015 — procedure **PS-8 PILI BOMBA**
>
> The Kad Rekod is a controlled record under JBPM's quality management system.
> Its content and layout answer to that procedure, **not** to this repository.
> Anything in this document that contradicts PS-8 is wrong and PS-8 wins.

---

## 1. What one card is

**One Kad Rekod = exactly 2 printed pages.** Never one, never three.

| Page | Sections, in order |
|---|---|
| 1 | Header block, then **Rekod Penyelenggaraan/Baik Pulih Kerosakan**, then **Rekod Pemantauan Teman Pili Bomba** |
| 2 | **Rekod Penyelenggaraan/Pengujian Pili Bomba**, then **Rekod Kompaun** |

Every page carries `Lampiran 5`, `KRPB`, and the card number. Page 1 of every
card repeats the full header (No. Pili, Lokasi, Jenis, Tarikh Pasang, and the
Teman Pili Bomba block) — a card must be readable on its own once detached.

### Row capacities — do not change these

| Section | Rows per card |
|---|---|
| Kerosakan | **11** |
| Pemantauan | **11** |
| Pengujian | **15** |
| Kompaun | **10** |

These are set by `SECTIONS[*].perPage` in `index.html`. They are not arbitrary
and they are not a display preference: they are what fits a real sheet of
paper. The print CSS sets row heights in **millimetres**
(`.ftab td{height:7.5mm}`, `.ftab.pengujian td{height:8.3mm}`) because 22 rows
plus roughly 75mm of header and section chrome has to land inside the 259mm of
usable height on Letter at an 8mm margin.

**Nothing from the app shell may print.** The isolation rule is
`body.form-open > *:not(#formOverlay){display:none}` — and it matches child
ELEMENTS only. A `body::before` decoration is invisible to it and will print
across the record; that happened once, with the 50th-anniversary watermark.
Any new full-page layer must be named explicitly in the print block, and
`tests/v2-app-live.js` T23 asserts it from the assembled app.

**Changing a row height, a font size, or a capacity can silently push the card
onto a third sheet.** That is not visible on screen. Anyone touching the print
CSS must re-render to PDF and count the pages.

---

## 2. How a new card is created

> When the **last row of any section** is **complete** and the card is
> **saved**, a whole new 2-page Kad Rekod is created.

This mirrors paper: a filled card is followed by a fresh card, not by squeezing
extra lines onto the old one.

Because the sections have different capacities, **whichever fills first** wins.
Fifteen Pengujian entries create a new card even though Kompaun still has eight
free rows — and the new card starts every section fresh, exactly as a new paper
card would.

### "Complete" is defined, not guessed

A row is **complete** when its **Tarikh is filled** *and* **at least one other
non-signature field is filled**.

Deliberately *not* "every column". `Catatan` is often left blank, and a Kompaun
row may legitimately use only the first of its two blocks. Demanding every
field would leave an officer with a full card and nowhere to write — the worst
possible failure for a field app. Requiring the date is not negotiable: a
record without a date is not a record.

Implemented as `rowIsComplete()` in `index.html`.

### It happens on save, not on keystroke

An earlier version created the card the moment any character landed in the last
row. A half-typed row is not a record, and a card conjured by one stray
keypress is a card the officer then has to explain.

Growth is triggered from the **Save** button, and from `openForm` once the
cloud copy lands — so a last row completed on another device also offers the
next card here.

**It fires on the local save, not on a successful upload.** `saveForm` writes
localStorage before it tries the network, so an officer with no signal still
gets their new card. Guarded by `tests/kad-rekod.js` T5.

---

## 3. Card numbering — permanent and chronological

> The oldest card is **always Kad 1**. A card's number never changes.

`Kad 1/3`, `Kad 2/3`, `Kad 3/3`, in the order the cards were created.

This matters because the Kad Rekod is an auditable record. A card that has been
signed and filed as *Kad 2* must still be *Kad 2* next year. Numbering by
screen position was considered and **rejected**: it would renumber every
existing card each time a new one appeared, and — since paper prints
oldest-first — it would have made the printed stack count *down*, `Kad 3/3`
then `Kad 2/3` then `Kad 1/3`.

The number is shown even when there is only one card (`Kad 1/1`), so an officer
can tell at a glance that no further cards exist.

---

## 4. Order — screen and paper differ, on purpose

| | Order |
|---|---|
| **Screen** | **Newest card first.** It is the only card anyone writes on; the officer should land on it, not scroll past years of filled cards on a phone |
| **Print** | **Oldest card first.** A filed paper record reads forward in time |

### How it is done, and why it must stay this way

The render loop in `buildFormHtml` emits cards **chronologically**, each card's
two `.fpage` divs wrapped in one `.fcard`. The screen flip is one CSS line:

```css
.fsheet{ display:flex; flex-direction:column-reverse }   /* screen */
@media print{ .fsheet{ flex-direction:column } }         /* paper  */
```

`column-reverse` reorders **cards**, never the two pages inside a card.

**Do not reverse the render loop instead.** Reversing the DOM also reverses the
printed output and breaks the `.fpage.pb{page-break-before:always}` rules — and
that failure is completely invisible on screen. It would be found by whoever
files the printed card, which is far too late.

The `TERKINI` tag marks the newest card on screen. It is **hidden in print**:
it is a screen affordance, not part of the record.

---

## 5. Signatures

Signing is **per row**, never per card. Only Kerosakan, Pemantauan and
Pengujian have a `T.T` column; Kompaun has none, and there is no card-level
sign-off.

**A signed row is permanent.** It cannot be edited, cleared or deleted — by
anyone, including an admin. This is enforced in three independent places:

1. The client disables every input in the row (`lockSignedUI`) and refuses to
   send an update or a delete for it.
2. RLS policies on `hydrant_records` carry a `signed = false` predicate.
3. A database trigger (`protect_signed_rows`) blocks the update or delete
   outright, independently of the policies.

Signature images are upload-only and never replaceable. They live in the
private `signatures` bucket and display through 1-hour signed links.

**The signature is the evidence.** Any change that could make a signed row
writable, or a signature image unreachable, is a correctness failure of the
same severity as losing the record itself.

### The Profile signature is a STENCIL, not evidence

**Decided by Ibrahim Ismail, 2026-08-09. Binding.**

An officer stores one signature on their **Profile** tab
(`profiles.signature`, a path under `profile/<uid>_<timestamp>.png` in the same
private bucket). Pressing **Sign** on a Kad Rekod fills the popup's preview from it,
instead of asking for a photograph every time — five taps in the field became
two, for something done dozens of times a week.

That signature **may be replaced, at any time.** This is the *only* signature
in the app that may be, and it does not weaken anything above, because of one
rule that must never change:

> **`signRow()` COPIES the stencil into the row's own object** at
> `signaturePath(hydrantId, section, rowIndex)`, with `upsert: false`, and
> stores **that** path on the record. **A filed row never points at
> `profile/<uid>.png`.**

If a row referenced the Profile object instead, an officer replacing a badly-lit
photo would silently rewrite the evidence on every record that pointed at it —
and by §5 those records can never be corrected. The copy is what makes
"replaceable stencil" and "permanent evidence" compatible at all.

Two consequences worth stating, because both look like inconsistencies to
tidy away and neither is:

- **Both uploads use `upsert: false`.** The Profile signature is replaceable,
  but not by overwriting: each save writes a **new timestamped object** and the
  profile is repointed at it. That is not a style choice — the bucket has one
  write rule, INSERT, and no UPDATE or DELETE, because that absence is what
  makes a filed signature permanent. An earlier version wrote to a fixed path
  with `upsert: true`; the first save worked and every replacement failed with
  *"new row violates row-level security policy"*. **Do not add an UPDATE or
  DELETE policy to make overwriting work** — that policy is the guarantee.
- **Buang tandatangan** clears `profiles.signature` and nothing else. The image
  stays in the bucket, unreferenced. Records already signed are untouched, as
  always, because each holds its own copy.
- The Sign button **fills the preview and stops there.** It does not confirm.
  Confirming is permanent, and the only thing standing between a mis-tap and an
  unremovable record is the officer looking at what they are about to file.

What a signature attests is unchanged: an admin, identified by their login
(`signed_by`), locked this row on this date. Only the moment of *capture*
moved earlier.

The file picker remains, as **Guna gambar lain** — an officer signing on a
colleague's device has no stencil on that account.

Guarded by `tests/v2-app-live.js` T19–T21. T21 asserts the paths and the
upsert flags on both sides, and that replacing a Profile signature writes
nothing outside `profile/`.

### Signatures are darkened for print, and it must stay that way

Signatures are **photographed**, so `stripSignatureBg` never produces black
ink — it keeps the pen's own colour at `*0.72` and ramps stroke mid-tones to
partial alpha. Measured on a typical signature the darkest pixel is luminance
**137**, and **not one pixel falls below 128**, against ~0 for the table rules
beside it. A backlit screen flatters that. Paper does not, and the first real
printout came out visibly faded.

> **Superseded 2026-08-08.** The filter described below made the ink black and
> also blackened the leftover paper, printing a **black box** around the
> signature on hydrant C26. What ships now is a pre-rendered print copy —
> `signatureForPrint()` in `index.html`. The original text is kept because the
> measurements in it are still true and still explain why the obvious fixes do
> not work.
>
> **What replaced it, and why it is not a filter at all.** `stripSignatureBg`
> cannot always key the paper out: on a badly-lit photo it leaves the
> background at low-but-non-zero alpha. Amplifying alpha — which is all a CSS
> filter can do — necessarily amplifies that too. The answer is to
> **threshold**: alpha at or above 0.65 **of the image's own strongest alpha**
> becomes solid black, everything below becomes fully transparent, written into
> a canvas and printed as a plain PNG.
>
> Three things about it are load-bearing:
>
> - **It is not a filter.** Measured: neither the CSS filter nor an equivalent
>   inline SVG filter survives `page.pdf()` — the current one was tested as a
>   control and came out of the PDF unfiltered, despite being confirmed black on
>   a real printer. A pre-rendered image leaves the print pipeline nothing to
>   drop.
> - **The cutoff is relative, not absolute.** An absolute 0.65 erased a
>   signature whose ink sat at alpha 158. **A signature missing from a printed
>   legal record is far worse than a grey box.** Taking the cutoff as a fraction
>   of the strongest alpha present keeps the ink at whatever level it was
>   captured.
> - **It is still render-side and print-only.** Signed rows are permanent, so a
>   capture-side change repairs no filed record, and the screen must not change.
>   The original `<img>` is never touched or reloaded; the print copy is built
>   beside it, best-effort. If the canvas cannot read the image (a cross-origin
>   host refusing CORS) the old filter still applies to that row — faded-but-
>   present beats absent.
>
> 0.65 was measured: below it the residue survives (0.55 → 7.7% dark against
> 5.3% of real ink), above it the strokes erode (0.70 → 5.2%).
>
> **Confirmed on a real printer, 2026-08-08.** No box, and the signature is
> present and legible. Both halves had to be checked: that the ink is black,
> and that the signature is still *there* — a threshold slightly too high
> erases faint strokes, and a missing signature on a filed record is worse than
> either defect this replaced.
>
> ---
>
> **The print copy has to be BUILT, and in V2 that crosses an origin
> (2026-08-13).** Everything above assumes `signatureForPrint()` ran. When it
> does, the printed ink is black and covers the same area as the ink on screen
> — measured across eight photo qualities, from a dark pen in good light to a
> pale pen thin and overexposed, the printed coverage never fell below the
> screen's. **So a faded printout does not mean the threshold is wrong; it means
> no copy was built and the row printed through the old filter.**
>
> That read is the fragile part. V2's signatures come from Supabase Storage, a
> **different origin**, and the copy used to be built by re-requesting the image
> with `crossOrigin="anonymous"` — a second request for a URL the page has
> already fetched without CORS, which depends on how the browser's cache treats
> the two modes and on the response carrying its header again on a
> revalidation. The bytes are now taken with a **`fetch`** first and read from a
> data URL, so the canvas is same-origin and cannot be tainted; the old probe
> remains as the fallback. A failed attempt no longer latches, so pressing Print
> again retries, and **Print waits for the copies** instead of the 60ms it used
> to guess at.
>
> Both outcomes of a failed read have reached paper, and which one you get
> depends on the print pipeline rather than on anything in this repo: the CSS
> filter is dropped by some (**faded**) and applied by others (**black box**,
> measured at 95.8% dark against 5.1% for real ink). Neither is acceptable on a
> legal record, which is why the copy is now the thing that is made reliable
> rather than the fallback that is made better.
>
> Guarded by `tests/v2-app-live.js` **T24**, which serves the signature from a
> second origin that answers a `fetch` with the CORS header and an image request
> without one. Verified red on the pre-fix bundle — 4 assertions fail, and the
> printed ink measures 95.8% dark.
>
> **That hardening was NOT the cause of the faded print, and this paragraph is
> the correction.** The officer's own PDF showed the embedded image was pure
> black with strictly binary alpha — `signatureForPrint`'s output — so the copy
> was built and was what printed. It covered **1.48% of the frame** against
> ~3.5% of visible ink: a stray diagonal and four dots. The signature had been
> **erased**, which this document calls the worst outcome available here.
>
> **The cutoff needs a second number, and here it is.** `SIG_PRINT_CUT` is 0.65
> of the image's PEAK alpha, and a peak is one pixel. A01 is a blue ballpoint
> carrying near-opaque blobs where the pen pressed and long pale sweeps where it
> barely touched; the blobs set the peak at 255, the cutoff landed at 166, and
> the sweeps went. A relative cutoff rescues a uniformly faint signature and can
> do nothing for one that is faint and dark at once.
>
> `SIG_PRINT_MAX_COVER = 0.06` walks the cutoff DOWN from 0.65×peak while what
> survives still covers less than 6% of the frame. **Area is the only thing that
> separates pale ink from pale leftover paper** — they sit at the same alpha,
> but a trimmed signature is a few percent of its frame and leftover paper is
> most of it. It can only ever LOWER the cutoff, so it cannot reintroduce the
> erasure; the cap is what stops it reintroducing the black box. Measured:
> A01's shape 1.15% → 3.55%, the residue fixture 5.02% → 5.35%.
>
> **Both apps carry it.** `index.html` is what officers print from until
> cutover and it has the same code; fixing only V2 helped nobody, and that
> mistake cost a printout. `tests/v2-signature-print-parity.js` runs both
> implementations over both fixtures and asserts the outputs are byte-identical,
> so the two copies cannot drift.
>
> **Confirmed on a real printer, 2026-08-13.** A01 prints, and the signature is
> whole. That is the fourth print defect in this document and the fourth found
> on paper — no screen, and no measurement I made, caught any of them.

The print CSS **used to** apply
`filter: brightness(0)` plus **three** `drop-shadow(0 0 0 #000)` passes.
`brightness(0)` flattens the ink to black while keeping alpha as the stroke
shape; the shadows do the real work, because **CSS filters cannot touch the
alpha channel** — `contrast()` cannot rescue a semi-transparent stroke, while
each shadow paints an opaque black copy behind it and compounds effective
alpha toward 1. Measured darkest/mean: none 137/187, 2× 5/85, **3× 0/54**,
4× 0/41. Three reaches solid black even on a badly-lit photo; a fourth only
thickens the stroke.

Two things about this are load-bearing:

- **It is print-only.** The screen rendering is already correct and officers
  look at it all day. The fix must not change it.
- **It is render-side, not capture-side.** A signed row is permanent and the
  image can never be re-uploaded, so correcting the capture pipeline would not
  help a single already-filed record. That is why `stripSignatureBg` is left
  alone.

**Confirmed on a real printer, 2026-08-08.** The signature reads solid black
against the table rules and the `Baik` text beside it. Three passes was the
right number — a fourth was measured (`darkest 0 / mean 41`) and is available
if a different printer ever needs it, but is not needed here.

The rule must also stay **after** the screen `.sigimg` rule in source order.
Both are the same specificity, so an earlier `@media print` block loses — a
`6.6mm` height declared higher up was silently dead for exactly this reason.
Guarded by `tests/kad-rekod.js` T7.

---

## 6. Before you change anything here

Check every one of these. Each corresponds to a real assertion in
`tests/kad-rekod.js`, and several correspond to a bug that has already
happened.

- [ ] Is a card still exactly 2 pages? **Render to PDF and count** — do not judge from the screen.
- [ ] Do a card's two pages still stay together and in order?
- [ ] Is the printed order still oldest-first, and the screen order newest-first?
- [ ] Do card numbers still start at 1 for the oldest and never change?
- [ ] Does a full column still produce a new card — **offline as well as online**?
- [ ] Are signed rows still untouchable on screen, in RLS, and in the trigger?
- [ ] No horizontal overflow at 360px.
- [ ] Does a signature still print **black**? Measure it — `darkest < 40` with
      real dark pixels present. It looked fine on screen when it was printing
      grey.
- [ ] Is it still a **signature and not a black box**? Measure the *fraction*
      of dark pixels: a signature is a few percent, a box is ~96%. Both defects
      satisfy "the ink is black", which is why the first one was fixed into the
      second without anything going red.
- [ ] Is the signature **still there at all**? A threshold that is slightly too
      high erases faint ink entirely, and a missing signature on a filed record
      is the worst outcome of the three.

Then run `npm run test:kad`, and the rest of `npm test`.

If a change alters what an officer sees on paper, **it needs the officer's
approval before it ships**, not after.
