# Changelog

## 3.6.2 (2026-06-29) — revert the 3.6.0 filter debounce

Backed out the self-calibrating filter debounce from 3.6.0 — it made large
files **worse**, not snappier (a 35k-row frame went translucent / unresponsive
while filtering). Root cause: the controller set its window from
`performance.now()` around `refresh()`, which measures the JS (rebuild +
`innerHTML` string build + parse) but **not layout/paint** — the dominant term
on a 2048-row × wide table. So the window was calibrated to a fiction, never
coalesced, and merely relocated each heavy synchronous render onto a timer
that, during a global-search index build, contended with the build's own
chunks while re-rendering the unfiltered view per keystroke. Filtering is back
to 3.6.1 behavior (immediate `refresh()` per input). The real fix — making each
render cheap and size-independent via **windowed rendering** — is planned
separately (`dev/plan-3.7-windowed-render.md`). The 3.6.1 filename-in-title
feature is unaffected.

## 3.6.1 (2026-06-29) — filename in the window title

The loaded file's name now shows in the **window/tab title bar** (the bar
at the very top — most useful for the installed PWA, where it's the window
title): `<filename> — CSV Viewer` once a file is on screen, back to plain
`CSV Viewer` on the ingest screen. App-only (`src/app/app.js`); the grid is
untouched.

## 3.6.0 (2026-06-29) — self-calibrating filter debounce

Typing and (worst of all) backspacing in the global fzf search or a column
filter felt sluggish on large files: there was **no debounce**, so every
input event ran a full `refresh()` (rebuild + render + status) back-to-back.
A single pasted query was already fast; the lag was doing that work N times
in a burst. Framed as queue stability — keystrokes arriving faster than
refreshes drain — the fix is a **self-calibrating trailing debounce**:

- The window equals the **last measured `refresh()` wall-clock**, seeded at
  100 ms and clamped to `[0, 300]` ms. Small files measure ~0 → the window
  collapses and we refresh every keystroke synchronously (today's instant
  feel, no timer churn). Large files grow the window to span a burst,
  coalescing it into one trailing refresh. No size threshold, no per-file
  tuning — the controller tracks the plant.
- **Scope:** both the global search and per-column filters, **inside the
  grid**, so the app navbar box, the grid's own box, and embedders all
  benefit. Filter **state** (query text, active-filter styling, Escape-clear)
  still updates immediately; only the view rebuild is deferred.
- New `setGlobalFilterDeferred(q)` is the debounced entry the app navbar uses
  on `input`. Public **`setGlobalFilter(q)` / `clearFilters()` stay
  synchronous** — the programmatic contract is unchanged.
- `destroy()` and a fresh `setData` load cancel any pending trailing timer
  (no refresh firing on a dead/replaced grid). Timer + window are
  per-instance — multi-instance safe.

## 3.5.0 (2026-06-26) — clickable rows & cells

All of `dev/plan-grid-spec.md` (a downstream embedder's request) — an
**additive, opt-in** way to make a grid's rows/cells clickable and receive
which row/cell was clicked as data, with enough identity to look the source
record back up. Default off is a true no-op (no listener, no DOM attrs, no
cost); the viewer app is unchanged.

- **`selectable` option (default false).** When on, one delegated click
  listener on the instance's own `<tbody>` (per-instance — no document
  listeners) dispatches a bubbling, cancelable
  **`CustomEvent('csvgrid:cellclick')`** from the grid root. `event.detail`
  carries `name`, `rowIndex` (the **original** source-row index, stable
  across sort/filter), `viewIndex`, `column`/`columnIndex`,
  `value`/`valueText`, and **`row`/`rowText` — the whole row keyed by column
  name** (raw + formatted), so identity rides in the event and nothing is
  reconstructed from DOM position. `value` is the typed number where the grid
  has one, else the raw string, else null for a blank. An embedder can
  `preventDefault()` to manage its own highlight. The grid itself takes no
  action on click beyond an optional selection.
- **`selectMode` (`'row'` | `'cell'` | `'none'`, default `'row'`)** — the
  visual highlight only (`'none'` still emits the event). Selection is
  per-instance, tracked by original index, and **survives re-render**
  (sort/filter/expand); it reads clearly in light and dark themes.
- **Instance handle** — `root.csvgrid` is set on the grid's own element, and
  static **`CsvGrid.forElement(elOrSelector)`** returns it (or null) — the
  documented way to reach a grid that `to_html`/`show` built anonymously.
  New methods `getSelection()` / `clearSelection()` / `selectRow(i)`.
- **`hiddenColumns` (string[] of header names, default null)** — columns
  kept in the data (so they ride in the event payload **and** export) but
  not rendered, e.g. ship a `trans_id` key without an ugly id column.
  Implemented as a `visibleCols` mask that only the render/measure/layout
  geometry walks; sort/filter/event stay on real column indices. With none
  hidden the mask is the identity list, so every geometry path is byte-for-
  byte today's behavior.
- **Python**: `selectable` / `select_mode` / `hidden_columns` flow through
  `show` / `to_html` (snake_case → camelCase); docstrings + READMEs updated.
  No Python callback — `to_html` stays a pure string emitter; behavior is
  wired to the DOM event (HTMX-friendly).
- **CSS**: `.csvgrid-selected` / `.csvgrid-selected-row` + a
  `--csvgrid-selected-bg` token (light + dark); the pointer cursor shows
  only when `selectable`. New fixture `dev/select-test.html` (two grids,
  row + cell modes, hidden key column, event log — verifies identity after
  sort/filter). `dist/` rebuilt + python embedded assets refreshed.

## 3.4.0 (2026-06-18) — currency-aware numbers

The grid now understands a battery of currency symbols and keeps them on
display, instead of treating `$` as a parse hint to strip and discard.

- **Currency battery `$ £ € ¥ ￥`.** Previously only a leading `$` was
  recognized; `£100`/`€100`/`¥100` failed to parse, so a non-dollar column
  inferred as **text** (left-aligned, no numeric sort) and a mixed `$`/`£`
  column demoted too. All five glyphs now parse (`¥` covers both yen and
  yuan; `￥` is the full-width CJK variant).
- **Fixed: `-$100` parsed as text.** The old pattern required the sign to
  follow the symbol (`$-100` worked, `-$100` didn't). A sign and a symbol
  are now accepted in **either order**; both `-$100` and `($100)` normalize
  to a canonical **`-$100.00`** (sign, then symbol, then grouped digits).
- **A currency symbol on the values means money.** Any such column formats
  as float with exactly **2 decimals**, regardless of header — a new
  value-based money trigger alongside the existing header trigger. It beats
  the year/identifier/percent header rules (a `$` value is money even if the
  header says "year").
- **The symbol is retained on display**, per cell: `$1,234.50`, `£1,200.00`.
  Mixed-currency columns show each cell's own glyph. A **bare** cell in a
  currency column stays bare (`100` → `100.00`, no symbol) — the grid never
  *adds* a symbol, only preserves one from the source. Numeric sort and
  right-alignment are unchanged (the symbol is display-only; no FX
  conversion). An explicit format spec suppresses the symbol (the
  mini-language has no currency char).

## 3.3.2 (2026-06-18) — ±infinity is numeric

Patch fix for a type-inference bug; realigns all four version locations on
one number (app trio was 3.3.0, python 3.3.1 — now all 3.3.2).

- **Fixed: a float column containing `inf` rendered as left-aligned text.**
  `±∞` is a legitimate `float64` value (e.g. an infinite moment), but no
  part of the parse/inference path understood it: `parseNumber` rejected
  every spelling, so one `inf` cell demoted the whole column to text.
  `show()`'s JSON payload emits the bare `Infinity` literal, which reaches
  the grid as `"Infinity"` via `String()`; loading the `to_csv()` output
  (literal `inf`) hit the same wall. (NaN was already handled — blanked.)
  Now `parseNumber` recognizes `inf` / `infinity` / `∞` / `Infinity`
  (case-insensitive, optional sign, accounting parens) as `±Infinity`, so
  the column infers **numeric** — right-aligned, sortable, filterable.
- **`classifyNumber` now computes magnitude stats over finite values only**
  — a stray `±∞` no longer makes `maxAbs` infinite and mislabels an
  otherwise-normal column as engineering format.
- **Non-finite cells display as literal `inf` / `-inf`** (not the `∞`
  glyph, which reads small); `engFormat` carries the same guard for a
  forced `eng`/`s` spec.

## 3.3.1 (2026-06-16) — python emitter

Python package (`csv-grid`) only; the app and JS bundle are unchanged.

- **Fixed: grids in JupyterLab randomly lost their styling** (text snapping
  right-aligned, rows wrapping/growing instead of truncating). Root cause:
  `show()` emitted the CSS + JS **once per kernel**, parked in a single
  cell's output and shared by every grid. Re-running or clearing that cell
  dropped the shared `<style>`, so all grids on the page fell back to
  JupyterLab's `.jp-RenderedHTMLCommon` table rules at once; a hard reload
  lost the runtime too. Fix: every grid now carries an **idempotent
  `<head>` injection guard** instead — assets live outside cell output (so
  cell churn can't strip them), dedupe by a DOM sentinel, and any grid
  re-establishes them if missing. The per-kernel `_assets_emitted` flag is
  gone; `assets` now means `'inline'` (default, head-injected), a base URL
  (linked tags), or `False` (manual escape hatch). `to_html()` fragments
  are self-contained and compose freely — no more "first fragment carries
  the assets" dance.
- **`theme='auto'|'light'|'dark'`** — force the grid's color scheme (sets
  `data-theme`), matching the R package; `'auto'` follows
  `prefers-color-scheme` as before.
- **`display_mode='auto'|'raw'`** — exposes the grid's raw-vs-inferred lens
  to Python (it was always in the grid, never wired into the option map),
  again matching R.
- `show()` docstring now lists every option.

## 3.3.0 (2026-06-16)

All of `dev/plan-3.3-bigint-percent-rawmode.md` — Stage D, in three parts.

### D1 — integers beyond 2⁵³ kept exact

An integer-form value too large for a float64 (`> 9,007,199,254,740,991`)
would be silently rounded, collapsing distinct values (a list of big primes,
a 20-digit account number). Such a column is now kept as **text** so every
digit survives verbatim. These columns read as numbers, so they are
**right-aligned** and sort by magnitude (numeric collation); they lose the
numeric `>`/`..` filters (substring only). Floats with big exponents
(`1.23e30`) are inherently approximate and stay numbers. New `isUnsafeBigInt`
in `core.js` — a pure lexical test, no `BigInt`, negligible cost in the
inference sample loop.

### D2 — percent format for ratio columns

Float columns named like ratios/rates (`ratio`, `rate`, `roe`, `roa`, `lr`,
`margin`, `yield`, `combined_ratio`, …) whose values are all `|x| ≤ 2` are
read as fractions and shown as percentages (`0.625 → 62.5%`, `1.04 → 104.0%`).
The `≤ 200%` value gate is the real guard: a column already in percentage
points (`rate` 62) is left alone, not turned into `6,200%`. All-integer
columns are skipped (units too ambiguous). Decimals are uniform per column =
the precision the data carried, less the two places `×100` shifts (clamped
1–4). Ranks above the money rule so a *loss ratio* isn't grabbed by `loss`.
The header match uses letter-only boundaries, so `loss_ratio` and other
snake_case names are caught. A `%`-suffixed source column round-trips
(`12.5% → 0.125 → 12.5%`).

### D3 — raw display mode

A bottom-right footer switch, **Inferred / Raw** (two explicit labeled states,
not a meaning-flipping toggle), flips the whole table to show source text
verbatim — no separators, no ISO dates, no percent, no engineering suffixes.
Type inference still runs, so columns stay aligned and sort correctly; only the
displayed text changes. Toggling is a re-render (cache + width re-solve), not a
re-parse. Purely a view lens, independent of export's own raw/formatted choice;
the date-ambiguity note is suppressed in raw mode (no reinterpretation happens).
Exposed on the library as the `displayMode` option and `setDisplayMode()`.

## 3.2.0 (2026-06-16)

All of `dev/plan-3.2-export-inference-responsive.md` — inference quality,
export, and a responsive toolbar.

### Responsive toolbar (Stage C)

The viewer toolbar now steps through four clean phases as the window
narrows, instead of wrapping buttons onto a second line one at a time:

1. **≥ 1500px** — every button shows its full label. The cutoff sits above
   the ~1450px the full bar needs, so buttons collapse to icons before Open
   could wrap to a second line.
2. **992–1500px** — labels collapse to icons; all buttons stay inline
   (tooltips carry the names).
3. **md–lg (768px)** — **Row 1, Copy, Save, Open** fold into a single
   right-aligned **"⋯ More"** dropdown; the search box is capped so search +
   the always-visible quintet (Clear, Balanced|Maximize, Expand, Contract) +
   More keep to one line.
4. **< md (768px)** — the search box takes its own full-width line and the
   buttons drop below it as one group, so brand / search / buttons end up
   neatly stacked (phone mode); the version number is dropped here too, the
   moment the bar stacks, so it doesn't flicker in and out.

Breakpoint-static (Bootstrap display utilities + a few media queries), no JS
width measuring; the inline and "More" layouts share one set of handlers
(only markup is duplicated). Easy to retune (`app.css` media queries + the
`d-lg-*` classes in `index.html`).

### Export (Copy / Save)

- **Copy and Save split-buttons** in the viewer toolbar. Primary click =
  current view as CSV; the caret menu offers **current view** or **whole
  table**, each as **CSV** or **Markdown**, with a single **Format values**
  toggle (default off = raw values as loaded; on = numbers/dates as
  displayed).
- **`grid.export({ scope, format, values })`** on the library returns the
  string. `scope`: `view` (current filter + sort) or `all` (every row in
  original file order, unfiltered — predictable). `format`: `csv` (RFC
  4180, CRLF) or `md` (markdown pipe table, type-based column alignment;
  delimiter row compact — `|:---|---:|` — for parsers like Sublime that
  reject spaces around the markers). `values`: `raw` or `formatted`; `formatted` is honored only when the
  chosen scope's row count is within `renderCap` (so a filtered view of a
  huge table can still be formatted), else it falls back to raw.
- New pure serializers `toCSV` / `toMarkdown` in `util.js`.
- Copy uses the async clipboard (textarea fallback off secure contexts);
  Save downloads a file — **CSV gets a UTF-8 BOM** (Excel-friendly; input
  already strips BOM, so round-trips stay clean), Markdown does not.
  Filename derives from the loaded file (fallback `table`).
- The split-button menus are driven by ~20 lines in `app.js` reusing
  Bootstrap's dropdown CSS — no Bootstrap JS bundle added (keeps load fast
  and the offline shell unchanged).
- The **Open** button now clears the paste textarea on the way back to
  ingest, so stale pasted text doesn't linger.

### Inference quality (Stage A)

Pure `core.js`/`util.js`; no startup cost beyond cheap checks in loops that
already ran.

- **Null tokens don't demote a column** — `NaN`, `NA`, `N/A`, `#N/A`,
  `null`, `none`, `-`, `--`, `.` (case-insensitive) are treated like blanks
  by inference, so a stray "NaN" no longer turns a numeric column into
  text. They render as empty cells in number/date columns; text columns
  keep the literal token (it may be a real category).
- **Type decided from a sample** — a column's number/date/text decision is
  now made from a stride sample of up to 2048 rows, not every row. One
  oddball deep in a large file can't demote an otherwise-clean numeric/date
  column; the stray cell is left unparsed and **rendered raw** (never
  hidden), and sorts as blank. Files ≤ 2048 rows are unchanged (sample =
  all rows). The typed values array is still built over every row.
- **Identifier columns lose the commas** — integer columns whose header
  looks like a code/key (`id`, `no`, `number`, `account`, `policy`,
  `order`, `zip`, `invoice`, `sku`, … — header text only) format as plain
  integers (`100200`, not `100,200`). Money-word headers win the overlap
  (`Order Amount`, `Account Balance` stay 2dp), and a year header/range
  still wins over both.
- **Leading-zero codes stay text** — a value that parses as a number but
  carries a significant leading zero (`007`, `01234`) forces the column to
  text so the zero survives; plain `0` and `0.5` are unaffected.
- **Ambiguous-date note** — all-numeric date columns are still read
  best-effort (month-first US m/d/y unless a day > 12 forces day-first). A
  column whose order was never pinned by the data is flagged; the viewer
  shows a lower-right footer note, e.g. *"Dates in Open Date, Close Date
  read as US m/d/y (ambiguous)."* Grid exposes `ambiguousDateCols`.
- **Tunables rounded to powers of two** — `WIDTH_SAMPLE` and `renderCap`
  2000 → 2048, `eagerCells` 200000 → 262144. (`sampleIndices` moved to
  `core.js`; the inference and width samples share the 2048 figure.)

## 3.1.0 (2026-06-13)

All of `dev/plan-3.1-options-responsive-fileassoc.md`: coverage column
fit, bounded height, dark mode, responsive toolbars, granular file
handlers, docs.

- **Coverage column-fit mode** — new `widthMode` option, `'equal-risk'`
  (default, unchanged) or `'coverage'`. Equal-risk gives every column the
  same truncation probability; coverage instead **maximizes the number of
  cells shown in full** — `max Σ F_j(w_j) s.t. Σ w_j ≤ budget`, solved by
  greedy water-fill over each column's upper concave envelope (buy the
  steepest cells-per-pixel slope first). It completes cheap thin-tail
  columns to 100% and concentrates truncation on the few expensive
  thick-tail outliers. Both modes share the tight / floors-and-scroll
  regimes and consume the same measured layout, so switching is a
  re-solve with no re-measure. The viewer exposes it as the **Fit:
  Balanced | Maximize** segmented control and the **`?widths=coverage`**
  URL param; Python via `show(df, width_mode='coverage')`. New solver +
  thin-vs-thick-tail checks (`grid.setWidthMode`).
- **Bounded height** — grid `maxRows` (cap the scroll viewport to ~N data
  rows, measured from the rendered table) and `height` (raw CSS
  max-height, overrides `maxRows`); vertical scroll for the rest, sticky
  header stays. Python `rows=` / `max_height=`. Not pagination. The
  separate `renderCap` DOM cap is unchanged.
- **Dark mode** — grid colors are now CSS custom properties on `.csvgrid`
  (light defaults); a `prefers-color-scheme: dark` block auto-follows the
  OS, and `.csvgrid[data-theme="dark"|"light"]` lets a host force either.
  This also **fixes the JupyterLab "white island" header** — the sticky
  header bg is `var(--csvgrid-bg)` instead of a hardcoded `#fff`, so it
  tracks the surrounding theme. The viewer sets Bootstrap `data-bs-theme`
  from the OS preference (inline in `<head>`, no flash; kept in sync
  mid-session) and its chrome uses theme-aware Bootstrap variables.
- **Responsive toolbars** — the viewer navbar collapses button labels to
  icons below the `lg` breakpoint and wraps as a last resort, so it stays
  usable down to phone width; the new Fit control collapses with the
  rest. The grid's own toolbar responds to the GRID's width (CSS
  container queries on `.csvgrid`), wrapping and widening the search field
  on narrow embeds.
- **Granular file handlers** — the manifest now registers `.csv`, `.tsv`,
  and `.tab` as one `file_handler` entry each (text/csv and
  text/tab-separated-values), so any one can be dropped without touching
  the others. `.txt`/`.md` stay off the OS "Open with" menu (the
  over-association trimmed in 3.0.6); in-app drag/drop/browse still accept
  all the formats. Redeploy + reinstall the PWA to pick up the change.
- **Docs** — the python `show()` docstring is now a single enumerated
  options reference (all snake_case options + the new `width_mode` /
  `rows` / `max_height` + dark-mode note); READMEs and the grid header
  comment updated to match.
- `dist/` rebuilt (es 31.4 KB, umd 24.6 KB, iife 24.4 KB) + python
  embedded assets refreshed; version bumped in the three JS places +
  python. Smoke test grows to 164 checks.

## 3.0.7 (2026-06-13)

Two embedding bugs found via the blog page (the Reading-Since-1990 qmd)
and JupyterLab — both verified fixed by reproduction.

- **Quarto pages showed an empty grid**: Quarto's Jupyter-engine HTML
  carries RequireJS, whose `define.amd` hijacks a umd wrapper — the
  bundle registered as an anonymous AMD module and `window.CsvGrid`
  never appeared (`ReferenceError`, blank div). Fix: new
  **`dist/csv-grid.iife.js`** (unconditional global, no module
  sniffing) — now the right file for ALL `<script src>` consumers; the
  python emitter inlines/links it instead of umd. umd remains for
  CommonJS `require()`.
- **JupyterLab right-aligned the text columns**: JLab's rendermime rule
  `:not(.jp-RenderedMarkdown).jp-RenderedHTMLCommon td {text-align:
  right}` outweighs `.csvgrid-table .col-text` by one specificity point
  (the `:not()` counts as a class). Fix: grid.css cell rules are now
  scoped `.csvgrid .csvgrid-table …`, which beats it decisively — no
  `!important`. New fixture `dev/jlab-align-test.html` replicates the
  JLab rule verbatim as the regression canary.

## 3.0.6 (2026-06-12)

Post-publication touch-ups.

- **File handler narrowed to `.csv` only** — registering for
  .tsv/.txt/.md too put "CSV Viewer" in the Open-with menu of files the
  author doesn't want associated. (Drag/drop and browse still accept
  all the formats; this only affects the OS association.) Redeploy +
  reinstall the PWA to pick up the manifest change.
- **PyPI Changelog link fixed** — pointed at `blob/main/`, but the
  repo's default branch is `master` (404 on the 3.0.5 PyPI page; live
  with the next upload).

## 3.0.5 (2026-06-12)

Naming consistency + PWA file handling.

- **PyPI distribution renamed `csv-viewer` → `csv-grid`** (decided for
  consistency before anything was published; both names were free).
  Final scheme: **csv-viewer** = the app/repo/Pages site; **csv-grid**
  = the component everywhere (JS class `CsvGrid`, npm name, dist
  files, `.csvgrid-*` CSS, PyPI distribution, Python import
  `csv_grid`). PyPI metadata points Homepage/Repository at the GitHub
  repo plus a "Live viewer" link to Pages; the main README links the
  PyPI package.
- **PWA file handling**: the manifest registers `file_handlers` for
  `.csv .tsv .tab .txt .md .markdown` and the app consumes
  `window.launchQueue` — once installed, "CSV Viewer" appears in the
  Windows "Open with" menu for those extensions and can be set as the
  default `.csv` app (Chromium desktop; one-time permission prompt on
  first use).

## 3.0.4 (2026-06-12)

Stages 5 + 6 of `dev/plan-3.0-grid-extraction.md` (python emitter +
docs) — the 3.0 arc is code-complete.

- **`python/csv_grid`** (uv project, local path install; pandas the
  only dependency): `show(df, **opts)` for Jupyter/Quarto (IPython
  display, assets emitted once per kernel/page), `to_html(df, **opts)`
  fragment for static generation, `payload(df)` for the raw
  {records, columns} dict. `assets='inline'` embeds the umd bundle +
  css (copies live inside the package, refreshed by `npm run build`);
  a base-URL string links them instead; False omits (dedupe). Options
  mirror the JS API in snake_case; `fmt` aliases `formats`; `worker`
  defaults False (data is inlined). Serialization: dates → ISO strings
  (hh:mm only for non-midnight columns), NaN/None/NaT → blank cells,
  integral float columns → ints (so the year/integer rules apply);
  types are re-inferred grid-side, per the plan — no automatic
  dtype→format hints, the inference is deliberately authoritative.
- Fixtures: `dev/embed-test-python.html` (generated, self-contained,
  two fragments exercising inline assets + dedupe + align/formats) via
  `uv run --project python dev/make-embed-test-python.py`, which also
  writes `dev/python-payload.json` — the pandas→JSON half of a
  round-trip the smoke test completes through `normalizeRecords` +
  formatting (158 checks).
- **Docs (stage 6)**: README rewritten around the two halves (app +
  library, with the CsvGrid quick start, csv_grid usage, and the live
  GitHub Pages URL); CLAUDE.md overview/commands/architecture rewritten
  to the 3.0 layout (serve-required, rebuild-dist-after-grid-changes,
  version in three places); `python/README.md`; post-3.0 deferred items
  (app bundling, Pages Action) recorded in the plan doc.
- **MIT LICENSE** added (root + copy in `python/` for the wheel);
  pyproject made PyPI-publishable: distribution name **csv-viewer**
  (verified free on PyPI; import name stays `csv_grid`), Python ≥ 3.11,
  authors/urls/classifiers/keywords. `uv build` verified: wheel carries
  the module, both embedded assets, and the license.
- **PWA icon fix**: `icon-192.png` and `apple-touch-icon.png` had
  shipped with the glyph slid half off the canvas since 2.1.1 — new
  headless Edge renders in a real window and Windows clamps the minimum
  window width (~340 px), so sub-340 `--window-size` captures crop a
  wider, centered layout. Icons are now rendered at 512 and downscaled
  (System.Drawing bicubic); recipe in `dev/icon-build/README.md`.

## 3.0.3 (2026-06-12)

Stage 4 revisited at the author's call: real Vite, which required the
ES-module migration the 3.0.2 concat build had avoided.

- **Source is now ES modules**, run natively in development — still no
  build step for the viewer, but a server is now required:
  `python -m http.server 8080` (module scripts do not load from
  `file://`; double-clicking index.html no longer works — accepted
  trade-off, decided 2026-06-12). `src/grid/core.js` exports its public
  functions; new **`src/grid/util.js`** holds the pure display logic
  (format specs, fzf, width solver, records normalization) as named
  exports; `src/grid/grid.js` is the library entry whose ONLY export is
  `CsvGrid` (default — keeps the UMD global a class, not a namespace);
  the worker is a module worker (`importScripts` gone); `app.js`
  imports CsvGrid; index.html has one `<script type="module">` tag.
- **`npm run build` = `vite build && vite build --mode umd`** (Vite 8 /
  Rolldown devDependency; node_modules gitignored). Same four committed
  `dist/` artifacts, now minified with sourcemaps (es 29.6 KB,
  umd 23.4 KB, worker 6.2 KB). Two passes because Rolldown replaces
  `import.meta` with `{}` in UMD output: the UMD pass rewrites
  `import.meta.url` to a `document.currentScript` polyfill captured at
  script-evaluation time (`define` + `intro`), and `renderBuiltUrl`
  points the worker asset at that variable — Vite's default helper
  reads `currentScript` lazily (null by worker-creation time) and would
  resolve the worker against the page instead of the bundle. Verified
  with the cross-directory fixture (page in `dev/`, bundle in `dist/`).
  `base: './'` keeps the worker reference relative, not root-absolute.
- Smoke test uses real imports (the `vm` concatenation harness is
  gone); dist check now asserts the default export. 151 checks.
- `dev/build.mjs` deleted; `sw.js` shell adds `util.js`, cache v3.0.3.

## 3.0.2 (2026-06-12)

Stage 4 of `dev/plan-3.0-grid-extraction.md` (library build). Viewer
unchanged (still plain script tags, no build in development).

- **`dist/` artifacts, committed** so consumers copy without building:
  `csv-grid.es.js` (ES module, `import CsvGrid from …`),
  `csv-grid.umd.js` (classic `<script>` → `window.CsvGrid`, or
  CommonJS), `csv-grid.worker.js` (self-contained parse worker — host
  next to the bundle, or pass `worker:false`), `csv-grid.css`.
- **Zero-dependency build** — `node dev/build.mjs` (`npm run build`),
  NOT Vite: the sources are deliberately plain scripts sharing globals,
  which a real module bundler would scope apart. The script
  concatenates core + grid, wraps (ESM export / UMD factory), and
  rewrites two marked lines in grid.js — worker discovery becomes
  `import.meta.url` (ES) and the worker filename becomes
  `csv-grid.worker.js`; it fails loudly if the marked lines drift.
  No node_modules, no devDependencies.
- **`package.json`** (`csv-grid`, private): `main`/`module`/`exports`
  map to dist (ready for aggregate_api's `file:` dependency),
  `npm run build` / `npm test`. Version now lives in THREE places:
  `VERSION` in app.js, the `sw.js` cache name, and `package.json`
  (stamped into the dist banners) — bump all three.
- Fixtures: `dev/embed-test.html` now runs against the dist UMD bundle
  (verified over http AND file://); new `dev/embed-test-es.html` (ES
  import) and `dev/worker-test-dist.html` (UMD bundle finds
  `csv-grid.worker.js` next to itself — the worker-pathing sharp edge,
  verified with a 2 MB parse). Smoke test grows to 151: the dist ES
  bundle must import in Node and export CsvGrid.

## 3.0.1 (2026-06-12)

Stages 2 + 3 of `dev/plan-3.0-grid-extraction.md` (options surface +
style self-containment). The viewer passes defaults — nothing visible
changes there.

- **Full v1 constructor**: `new CsvGrid(elementOrSelector, data, options)`.
  Data forms: `{csv}`, `{records, columns}` (objects or arrays;
  null/undefined/NaN → ''; types re-inferred), `{url}` (fetched). All
  take optional `name` (status line) and `headerMode` override.
  `setData` returns a promise — superseded loads never settle, failures
  reject AND show in the grid (pre-handled, so embedders may ignore it).
- **Options**: `globalSearch`, `columnFilters`, `sortable`, `statusBar`
  (true / false / host element), `expandButtons`, `align` ('llrcr…',
  rides the markdown `col.align` plumbing), `formats` (per-column
  `[,][.N](f|d|%|e|s)` + named 'year'/'eng'; null = auto rules),
  `renderCap`, `eagerCells`, `worker` (true/false/url),
  `headerMode` ('auto'/'first-row'/'headerless'). Plus `destroy()`.
- **Worker management moved into the grid** (was viewer chrome): csv
  ≥ ~1 MB parses off-thread, worker.js found relative to grid.js via
  `document.currentScript`; `file://` and `worker:false` stay
  synchronous. Parse progress shows in the grid's status line.
- **Grid generates its own DOM** (toolbar / table / filter row /
  render-cap note / error line / status) with namespaced `.csvgrid-*`
  classes styled by `src/grid/grid.css` — no Bootstrap inside the grid.
  `src/styles.css` split into `grid.css` + chrome-only
  `src/app/app.css` (drop zone, footer, card look on the scroll area).
  index.html's table view collapses to one `#grid-root` div.
- **Viewer** drives its navbar controls via `setGlobalFilter` /
  `clearFilters` / `expand` / `contract`; the grid renders row counts
  into the footer's `#status` element (`statusBar: element`); loads go
  through `grid.setData({csv})` promises (view switch on resolve, back
  to ingest with the message on reject).
- New fixtures: `dev/embed-test.html` (two grids on a bare page, no
  Bootstrap — stage 3 exit) and `dev/worker-test.html` (worker + {url}
  path, the stage-4 canary). Smoke test grows to 148 checks (format
  spec parser, align spec, records normalization, override precedence).
- `sw.js` cache → v3.0.1; shell list swaps styles.css for the two new
  css files.

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
