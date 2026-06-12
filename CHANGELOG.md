# Changelog

## 3.0.0 (2026-06-12)

Stage 1 of `dev/plan-3.0-grid-extraction.md` (instance-ification). NO
feature or behavior change — the app looks and acts exactly like 2.1.1.

- **`CsvGrid` class** in `src/grid/grid.js`: all grid machinery
  (formatting, fzf search, filter/sort view, equal-risk widths,
  drag-resize, lazy formatting, chunked search index, render, status)
  moved off the module-global `state` onto instance fields. No
  document-level listeners inside the grid (the transient drag-resize
  pair excepted); it renders into elements handed to the constructor —
  own-DOM generation comes in stage 3. Public surface so far:
  `setData`, `setGlobalFilter`, `clearFilters`, `expand`, `contract`,
  `applyLayout`.
- **`src/core.js` → `src/grid/core.js`**, `src/worker.js` →
  `src/grid/worker.js` (both content-unchanged; the worker's relative
  `importScripts('core.js')` still resolves).
- **`src/app.js` → `src/app/app.js`**, now chrome only: ingest cards,
  drop/paste/Ctrl+O/Ctrl+V, toolbar wiring, parse dispatch (sync vs
  worker), `?src=`, PWA registration. It instantiates the one grid and
  feeds it `processData` results.
- `sw.js` cache → v3.0.0, shell list + scope regex updated for the new
  `src/grid/`, `src/app/` paths (hard-refresh after deploying).
- Smoke test harness points at the new paths; all 120 checks pass
  unchanged. Verified in headless Edge against `?src=dev/sample.csv`.

## 2.1.1 (2026-06-12)

- **Year range now 1800–2100 inclusive** (was the literal-spec
  1801–2029): a 1990–2030 projection column year-ifies properly, with
  headroom for forward projections. Boundary tests added.
- **Phone-grade PWA icons**: 192/512 PNGs (purpose `any`) plus a
  maskable 512 (white glyph on brand blue, safe-zone padded) in the
  manifest, and a 180×180 `apple-touch-icon` for iOS (which ignores
  manifest icons). Rasterized from the actual bi-table SVG with headless
  Edge; the build pages live in `dev/icon-build/` for regeneration.

## 2.1.0 (2026-06-11)

Executed from `dev/plan-2.1-worker-restructure.md`.

- **Web Worker parsing**: texts ≥ 1 MB parse + infer off the main thread
  — the tab stays live with "parsing name (14.6 MB)…" in the status bar.
  Small inputs keep the zero-latency synchronous path; `file://` (no
  worker allowed) falls back to synchronous automatically. Stale worker
  replies (rapid re-drops, header toggles) are discarded by generation.
- **Source restructured into `src/`** (git mv, Vite-shaped, still no
  build): `src/core.js` (pure data logic, shared by page and worker via
  `importScripts`), `src/app.js` (UI), `src/worker.js`,
  `src/styles.css`. `index.html`, `favicon.svg`, `manifest.webmanifest`,
  and `sw.js` stay at root (service-worker scope requires it).
- New pure entry point `processData(text, headerOverride)` in core —
  the md-vs-CSV decision, parse, header detection, inference, guessed
  names in one testable function.

## 2.0.0 (2026-06-11)

Large-file release, executed from `dev/plan-2.0-speedups.md`. Internal
overhaul — no behavior change for small files (≤ 200,000 cells stay fully
eager). Benchmarks on a 250K-row × 6-col synthetic file.

- **Crash fix (the actual 250K wall)**: `Math.max(...spread)` over a
  250K-element array blew the call stack in number classification;
  replaced with a loop. Any large numeric column crashed before this.
- **Sampled width measurement**: equal-risk width percentiles now come
  from a ~2,000-row deterministic stride sample per column instead of
  every cell (a quantile estimate, statistically equivalent) — eliminates
  millions of canvas `measureText` calls. Trade-off: the sample max may
  miss a freak-wide outlier cell (tooltip/drag/dblclick-fit cover it).
- **Lazy formatting**: display strings are formatted per row on demand;
  loads format ~4K rows (render cap + width sample) instead of all.
  68ms vs 54s on the benchmark, helped by caching `Intl.NumberFormat`
  per decimal count (construction is ~100× a format call).
- **Deferred, chunked search index**: built on the first global-search
  keystroke in 10K-row chunks that yield to the UI ("indexing search …%"
  in the status bar); the pending query applies on completion. Column
  filters and sorting never wait. Stale builds abandoned on new loads.
- **Date inference single-parse**: candidacy needs one parse, not two;
  columns re-parse only when a day-first signal appears (UK-style data).
  Inference 4.9s → 2.0s on the benchmark.
- Worker and Vite deliberately pended; remaining load cost (parse +
  inference ≈ 2.4s at 250K rows) is the future worker's territory.
- Smoke test extended to 118 checks.

## 1.5.1 (2026-06-11)

- **Status bar moved to the lower left** (fixed footer): file name,
  `shown of total rows × cols`, `showing rows 1–N` when render-capped,
  and the headers-guessed note. Hidden on the ingest screen.
- The old bottom-center `csv-viewer vX.Y.Z` footer line dropped — the
  version already lives under "CSV Viewer" top left.

## 1.5.0 (2026-06-11)

Executed from `dev/plan-1.5-markdown-tables.md`.

- **Markdown pipe tables** open like CSVs (file, paste, drag, `?src=`):
  detected by the `|:--|--:|`-style separator row, outer pipes optional,
  escaped `\|` honored inside cells. **Alignment follows the separator
  spec** (`:--` left, `:-:` center, `--:` right) and overrides the
  type-based alignment; bare `---` keeps the viewer's default. All
  downstream machinery (type inference, number/date formatting, search,
  filters, width allocation) applies unchanged.
- File picker accepts `.md`/`.markdown`; fixture `dev/sample-table.md`;
  smoke test extended to 113 checks.

## 1.4.3 (2026-06-11)

- Expand is no longer a toggle: separate **Expand** and **Contract**
  buttons (no play/pause-style meaning changes). Contract returns to the
  fitted equal-risk layout and also clears any drag-resized widths.

## 1.4.2 (2026-06-11)

- **Drag-to-resize columns**: grip on each header's right edge. Dragging
  sets a manual width (min 24px) that survives window resizes and the
  Expand toggle, and resets on the next file load. **Double-click the grip
  fits the column to its content** (Excel-style) — the intended answer to
  "one wide column I want to read without expanding them all".

## 1.4.1 (2026-06-11)

Bug fix.

- Scientific notation (`1e-03`, `2.5E+05`) and bare leading-dot floats
  (`.5`) are now recognized as numbers — previously one such value made
  the strict inference demote the whole column to left-aligned text.
  Implied decimals are exponent-aware (`1e-03` → 3dp, `1.5e-3` → 4dp), so
  the downstream format rules see sensible precision.

## 1.4.0 (2026-06-11)

Executed from `dev/plan-1.4-header-toggle-dates-money.md`.

- **"Row 1 = header" toolbar toggle**: shows the mode in effect
  (auto-detected on load); clicking re-interprets the loaded data with the
  opposite assumption.
- **Liberal date recognition**: numeric triples with `/`, `-`, or `.`
  separators and 2- or 4-digit years; month-name forms (`5 Jan 2024`,
  `05-Jan-24`, `Jan 5, 2024`). US/UK ambiguity resolved per column: one
  value with day > 12 flips the whole column to day-first; otherwise
  month-first. Display stays ISO.
- **Money formatting rules** (trump the magnitude rule): a money-ish
  header (`amount`, `balance`, `price`, `premium`, `loss`, currency
  symbols, …) forces 2dp even on integer columns; float columns with ≤ 2
  observed decimals and max |x| < 100,000 get exactly 2dp. Year
  classification still wins over a money title.
- **Bank-download hardening**: UTF-8 BOM and leading blank lines stripped
  before sniffing (a leading blank line previously collapsed the file to
  one column).
- Test fixture `dev/sample-bank-uk.csv` (BOM + blank lines + day-first
  dates); smoke test extended to 97 checks.

## 1.3.0 (2026-06-11)

Executed from `dev/plan-1.3-browse-headers-expand.md`.

- **Headerless CSV support** (bank-export style): if any first-row cell
  parses as a number or date, the row is treated as data and column names
  are guessed from inferred types — `Date`, `Amount`, `Description`
  (`Year` for year-like integers), numbered when a type repeats. Status
  bar shows "(headers guessed)".
- **Expand toggle** in the toolbar: gives every column its natural
  fully-visible width, bypassing the equal-risk squeeze (table scrolls
  horizontally). Sticky for the session.
- Explicit blue **Browse…** button in the open-file card (same as
  clicking the drop zone).
- Version number centered under "CSV Viewer" in the header.
- Smoke test extended to 74 checks.

## 1.2.0 (2026-06-11)

Formatting, keyboard, and PWA release, executed from
`dev/plan-1.2-formatting-keyboard-pwa.md`. Number formatting now follows
the greater_tables conventions.

- **Number formats per column**: integers always get thousands commas
  EXCEPT year columns (all-integer and header matches
  `year|yr|vintage|cohort` or all values in 1800–2030), rendered plain;
  float columns spanning > 6 orders of magnitude use engineering format
  (3 significant digits, SI suffixes n µ m k M G T).
- **Sensible float format** (white whale candidate): uniform per-column
  decimals `d = clamp(min(maxObservedDecimals, 3 − floor(log10(mean|x|))),
  0, 6)` — ~4 significant digits at the column's typical magnitude, never
  more precision than the raw data carried. Money-scale columns drop
  cents; unit-scale keep them.
- Dates now **center-aligned** (greater_tables convention; were right).
- `Ctrl+O`: from the table view returns to the ingest screen; from the
  ingest screen opens the file browser directly.
- `Esc` in any filter box (global or column) clears that filter and blurs.
- Favicon: the navbar's Bootstrap `table` glyph as an SVG favicon in
  primary blue (`favicon.svg`).
- Version shown in fine print under "CSV Viewer" in the header.
- Table default font size reduced to 0.8rem (~80%).
- **`?src=<url>`**: the page auto-loads a CSV named in the query string
  (errors surface in the ingest error pane; cross-origin subject to CORS).
  Enables iframe embedding in blog posts.
- **PWA**: `manifest.webmanifest` (standalone, grid icon) + `sw.js`
  service worker precaching the app shell and CDN CSS for offline use;
  installable from Edge/Chrome when served over localhost or https.
  `?src=` data fetches are never cached. Not wired for .csv file
  association (deliberately).
- Smoke test extended to 67 checks (format classification, year detection,
  engineering format).

## 1.1.0 (2026-06-11)

Punch-up release, executed from `dev/done/plan-1.1-fuzzy-and-widths.md`.

- **fzf-style global search**: space-separated terms AND together; fuzzy
  subsequence matching with fzf-v1-style scoring (word-boundary and
  consecutive-match bonuses, window and late-start penalties). Extended
  syntax subset: `'exact`, `!exclude`, `^prefix`, `suffix$`; smart case
  (uppercase in a term = case-sensitive). When no column sort is active,
  rows order by match score, best first.
- **Tight columns + equal-risk width allocation**: formatted cell widths
  measured once per load (canvas `measureText`); columns get their minimum
  fully-visible width when everything fits, otherwise the single percentile
  q is found (bisection) such that per-column q-th-percentile widths sum to
  the viewport — every column truncates with equal probability; low-sd
  columns display fully. Widths are frozen per load (no live reflow while
  filtering); they re-solve only on window resize. Implemented via
  `<colgroup>` + `table-layout: fixed`.
- Tooltips now appear only on actually-truncated cells (delegated, lazy).
- Smoke test extended to 51 checks (query parser, fuzzy scoring, width
  solver).

## 1.0.0 (2026-06-11)

Initial release, executed from `dev/done/plan-1.0-initial-viewer.md`.

- Zero-build vanilla JS/HTML SPA: open `index.html`, no server or framework.
- Ingest screen modeled on the archivum `/ingest` page: drag-and-drop zone
  (or click to browse), paste textarea, and direct Ctrl+V paste. Files can
  also be dropped anywhere on the page.
- RFC 4180 parser with automatic delimiter sniffing (comma, tab, semicolon,
  pipe); handles quoted fields, doubled quotes, embedded newlines, ragged
  rows.
- Per-column type inference: number (thousands commas, `(123)` negatives,
  `$`, `%`), date (ISO and US slash forms, optional time), text.
- Sensible formatting: thousands separators, per-column fixed decimals
  (max observed, capped at 6), dates normalized to `yyyy-mm-dd`.
- Numbers and dates right-aligned, text left-aligned; columns autosize with
  a 50ch cap (ellipsis + tooltip for long values).
- Click-to-sort headers (asc / desc / reset), type-aware, blanks last.
- Global search box plus per-column filter row; numeric/date columns accept
  `>x`, `>=x`, `<x`, `<=x`, `=x`, and `a..b` ranges.
- Render cap of 2,000 rows with "show all" (filter/sort always cover the
  full data); status bar with file name and shown/total row counts.
- Logic smoke test: `node dev/smoke-test.mjs` (35 checks).
