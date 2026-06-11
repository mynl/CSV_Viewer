# plan-1.2-formatting-keyboard-pwa — formatting, keyboard, chrome, ?src=, PWA

From discussion 2026-06-11 (evening). Formatting spec follows
[greater_tables](https://github.com/mynl/greater_tables_project): integers
comma-separated, years not, floats by magnitude, dates ISO and
center-aligned.

## 1. Number formatting

Per numeric column, classify into a `format`:

- **year** — all values integer and (header matches `year|yr|vintage|cohort`
  OR all values in (1800, 2030)). Rendered plain, no commas: `1995`.
- **int** — all values integer-valued: commas, no decimals.
- **eng** — float column spanning > 6 orders of magnitude
  (max|x| / min nonzero |x| > 1e6): engineering format, 3 significant
  digits, SI suffixes n µ m k M G T (the greater_tables wide-range rule).
- **float** — everything else. *The sensible float format (white whale
  candidate):* uniform decimals per column,
  `d = clamp( min(maxObservedDecimals, 3 − floor(log10(mean|x| over
  nonzero))), 0, 6 )` — i.e. show ~4 significant digits at the column's
  typical magnitude, but never invent precision the raw data didn't have.
  Money-scale columns (mean ~10⁴) drop cents; unit-scale show 2–3 dp;
  small ratios get what they need. Commas always.

Dates: ISO as before, now **center-aligned** (greater_tables rule; was
right-aligned).

## 2. Keyboard

- `Ctrl+O` — from the table view, return to the ingest screen; from the
  ingest screen, open the file browser directly. Button stays.
- `Esc` in a column filter box (or the global box): clear that filter and
  blur out of it.

## 3. Chrome

- Favicon: the same Bootstrap Icons `table` glyph as the navbar brand, as
  an SVG favicon in Bootstrap primary blue (`favicon.svg`).
- Small `v1.x.y` in fine print under "CSV Viewer" top-left, populated from
  `VERSION` (footer keeps it too).
- Table default font size 80% of current (1rem → 0.8rem).

## 4. `?src=<url>` loader (pulled into 1.2)

On page load, if the query string has `src`, fetch it and load as if
pasted; errors land in the ingest error pane. Enables blog embedding
(iframe pointing at the viewer + a CSV in the post's resources). Subject
to CORS for cross-origin sources.

## 5. PWA (pulled into 1.2)

The author likes and uses PWAs — this is for installability and offline,
explicitly NOT for .csv file association (that would additionally need
`file_handlers` + `launchQueue`; not in scope).

- `manifest.webmanifest`: name, standalone display, theme `#0d6efd`,
  SVG icon (the favicon).
- `sw.js`: precache the app shell incl. the two jsdelivr CSS files;
  cache-first for shell + CDN (icon fonts get runtime-cached), straight
  network for everything else — `?src=` data is never cached. Cache name
  carries the version; old caches deleted on activate.
- Registration only on https/localhost (no-op from `file://`). Install
  via Edge → app window with the grid icon.

## Later (logged, not v1.2)

- **Blog embedding** — `?src=` now exists; remaining work is in the blog
  repo: iframe the viewer from the Reading-Since-1990 post (replacing
  ITables) with the CSV in the post resources.
- **Windows "open with" for .csv** — would need `file_handlers` +
  `launchQueue` on top of the PWA, plus permanent https/localhost serving.
  Not currently wanted (author: PWA ≠ association; he just likes PWAs).

## Steps

1. `inferColumns`: per-column format classification (+ stats); `formatCell`
   year/int/eng/float branches; `engFormat`.
2. Keyboard handlers; Esc-to-clear on all filter inputs.
3. `favicon.svg`; header version block; font size.
4. `?src=` loader; `manifest.webmanifest` + `sw.js` + registration.
5. Extend smoke test (year detection, float-d rule, engineering format).
6. Bump 1.2.0; CHANGELOG; human-hints (incl. blog + app-ification notes).

*Stays in `dev/` until the author says it is done.*
