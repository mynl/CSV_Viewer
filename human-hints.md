# human-hints

Very high-level running summary of discussions and decisions in this
project. Newest first. The pinned section below tracks the current
formatting rules.

## Number & date formatting rules (current as of v3.2)

Per numeric column, first match wins:

1. **Year** — all integers AND (header matches `year|yr|vintage|cohort`
   OR all values in 1800–2100 inclusive, v2.1.1): plain, no commas
   (`1995`).
2. **Identifier** (v3.2) — all integers AND header matches an id/code word
   (`id|no|num|number|account|acct|code|zip|postal|phone|fax|ssn|ein|tin|
   invoice|inv|ref|reference|sku|upc|isbn|order|customer|cust|member|
   policy|claim|seq`) AND **not** also a money header: plain integer, no
   commas (`100200`). Header text only — no value heuristics.
3. **Money by header** — header matches `amount|amt|balance|price|cost|
   fee|charge|paid|payment|debit|credit|total|premium|loss|salary|wage|
   income|expense|revenue` or a currency symbol/code: exactly 2dp with
   commas, even for all-integer columns. Wins the id/money overlap
   (`Order Amount`, `Account Balance` stay 2dp).
4. **Integer** — all integer-valued: commas, 0dp.
5. **Money by value** — floats with ≤ 2 observed decimals and max |x|
   < 100,000: exactly 2dp ("probably money").
6. **Engineering** — floats spanning > 6 orders of magnitude: 3
   significant digits with SI suffixes n µ m k M G T (`4.5M`).
7. **Sensible float** (the white-whale rule) — uniform decimals
   `d = clamp(min(maxObservedDecimals, 3 − floor(log10(mean |x| over
   nonzero))), 0, 6)`: ~4 significant digits at the column's typical
   magnitude, never more precision than the raw data carried. Example:
   mean ~10⁵ → 0dp; mean ~10 → 2dp; mean ~0.02 → up to 5dp (capped by
   observed precision).

Type decision (v3.2): made from a stride sample of ≤ 2048 rows, so one
oddball deep in a big file can't demote a clean numeric/date column — the
stray cell renders raw. Null tokens (`NaN NA N/A #N/A null none - -- .`)
count as missing, never demote, render blank (number/date cols; text cols
keep them). A value parsing as a number with a significant leading zero
(`007`) forces the column to text.

Dates: recognized liberally (ISO, `13/01/2024`, `13-05-24`, `13.05.2024`,
`5 Jan 2024`, `05-Jan-24`, `Jan 5, 2024`; 2-digit years pivot at 50);
day-first vs month-first decided **per column** (any day > 12 flips the
column to day-first, else US month-first); always displayed ISO
`yyyy-mm-dd`, center-aligned. Numbers right, text left. Number parsing
accepts `1,234.56`, `(2,500)`, `$99.50`, `12.5%`, `1e-03`, `.5` (v1.4.1:
scientific notation, with exponent-aware implied decimals).

Search note (by design, confirmed 2026-06-11): the global box matches
against each row's cells concatenated into one string — formatted values
first, then raw values. So `^` anchors the start of the first column and
`$` the end of the last RAW cell (which can differ from the displayed
value). For per-cell matching use the column filter boxes.

## 2026-06-16 — 3.2 Stage C landed (responsive toolbar, 4 clean phases)

- Steve's spec: four discrete phases, no bit-by-bit button wrapping. (1)
  ≥xxl full labels; (2) lg–xxl icons inline; (3) md–lg Row1/Copy/Save/Open
  fold to "⋯ More" (quintet + search + More on one line); (4) <md search
  takes its own full-width line, buttons drop below as one group → brand /
  search / buttons stacked (phone). The earlier jank was flex-wrap peeling
  buttons off between ~576–768.
- **Key fix (CSS-only):** force `#global-filter { flex:1 1 100%; max-width:
  none !important }` at `<md` (767.98) so search owns a line and buttons
  wrap below as a block; cap search `max-width:14rem !important` at `<lg` so
  phase 3 stays one line. **!important needed** — the input has an inline
  `max-width:320px` that beats plain rules.
- Label-collapse stays at xxl (1399.98); More fold stays at lg (992,
  `d-lg-*` in index.html). Quintet always visible (NOT folded into More) —
  phase 4 shows quintet icons + More below search.
- No HTML/JS change in this pass, no dist rebuild. Breakpoints all tunable
  in app.css + the d-lg-* classes.
- app.js: `doExport` → `runExport(src, …)` resolves the enclosing dropdown
  (`.btn-group`/`.dropdown`) for that menu's Format-values toggle + a button
  to flash; `openAction`/`headerAction`/`syncHeaderActive` shared by inline
  button and More item (Row-1 `.active` synced across both). No src/grid
  change in Stage C, so no dist rebuild needed.
- All three 3.2 stages now implemented; CHANGELOG still "(in progress)" —
  finalize the date when Steve confirms done (then plan → dev/done).

## 2026-06-16 — 3.2 Stage B landed (export: Copy / Save)

- `grid.export({scope,format,values})` in grid.js; pure `toCSV`/`toMarkdown`
  in util.js. scope view=filter+sort, all=original file order unfiltered.
  formatted gated per-action to `renderCap` (2048), else raw fallback.
- Copy + Save split-buttons in the toolbar (right cluster, `ms-auto` moved
  from Open to the Copy group). Dropdowns driven by a ~20-line vanilla
  helper in app.js reusing Bootstrap's dropdown CSS — **deliberately did
  NOT add the Bootstrap JS bundle** (speed + offline shell unchanged).
  Stage C's "More" menu can reuse `initMenus()`.
- CSV save gets a UTF-8 BOM; markdown none. Copy via async clipboard with a
  textarea fallback. Brief on-button "Copied"/"Saved" flash.
- Two plan refinements flagged: (1) **one uniform Format-values checkbox,
  default raw**, applied to all four actions — dropped the plan's per-format
  smart default (MD→formatted) for predictability. (2) **Checkbox stays
  enabled; export gates per-action on row count** rather than disabling the
  checkbox for big tables — lets a small filtered view of a big table still
  format. One-line changes if Steve wants the plan's originals.

## 2026-06-16 — 3.2 Stage A landed (inference quality)

- Implemented all of Stage A in `core.js`/`util.js`; version bumped to
  3.2.0 (app, sw cache, package.json, python). dist rebuilt, smoke test
  green (now with A1–A5 checks). B (export) and C (responsive) still to do.
- Two judgment calls flagged to Steve (refinements to the written plan):
  (1) **null-token blanking gated to number/date columns** — text columns
  keep `None`/`NA` (could be a real category); also cheaper (only when
  `values[r]===null`). (2) **A3 precedence is year → (id AND not money) →
  money → int**, not the plan's year→id→money — so `Order Amount` /
  `Account Balance` keep 2dp instead of going plain. One-line revert each
  if he disagrees.
- `sampleIndices` moved from util.js to core.js (inference needs it),
  re-exported from util.js so importers are unaffected. New: `isNullToken`,
  `numDateOrder` (private), `ID_TITLE_RE`, `LEADING_ZERO_RE`, `INFER_SAMPLE`.
- Grid exposes `ambiguousDateCols`; app renders the lower-right footer note
  (`#date-note`). The grid's own built-in status bar does NOT auto-append
  it (avoids changing embedder output) — embedders read the property.

## 2026-06-16 — 3.2 plan drafted (export, inference, responsive)

- Plan at `dev/plan-3.2-export-inference-responsive.md`. Decided **3.2.0,
  not 4.0** (all additive). Three stages, A independent, B→C coupled.
- **A (core.js inference quality)**: null-token set (NaN/NA/N/A/#N/A/null/
  None/-/--/.) treated as missing + rendered blank; **type decided from
  the 2048 sample** (oddball deep in a big file no longer demotes; stray
  cell renders raw verbatim — `formatCell` already passes raw through when
  `values[r]===null`); identifier integer columns (header regex ONLY:
  id/no/account/code/zip/… ) → plain ints, no commas (precedence year →
  id → money → int); leading-zero codes (`007`) → text; dates keep the
  current per-column guess (ambiguous all-numeric → US m/d/y) but add a
  **lower-right note** listing columns converted under genuine ambiguity.
- **Global (powers of two)**: WIDTH_SAMPLE 2000→2048, default renderCap
  2000→2048, eagerCells 200000→**262144** (2¹⁸). NOT the fixYear century
  base, NOT the 1800–2100 year range.
- **B (export)**: `toCSV`/`toMarkdown` in util.js; `grid.export({scope,
  format,values})`; Copy (split-button, clipboard) + Save (split-button,
  Blob, UTF-8, **BOM on CSV-save**). view=filtered+sorted, all=original
  order. **raw default; formatted gated to ≤2048 rows** (Steve's call —
  formatted only for small tables, keeps the click instant).
- **C (responsive)**: breakpoint-static "⋯ More" dropdown (no JS
  measuring; dynamic priority-plus rejected). Always-visible quintet:
  Clear | Balanced | Maximize | Expand | Contract. Open / Row 1=header /
  Copy / Save fold into More on narrow widths. Fixes Open wrapping to row
  2.
- **Column-stats popover: OUT** (nice, low priority, skipped). Plan
  written; nothing coded yet — awaiting Steve's go to execute Stage A.

## 2026-06-13 — 3.1 stages 1–4 executed (v3.1.0)

- Steve: execute the 3.1 plan stage by stage, carry on while tests stay
  green, stop on unexpected issues. Did stages 1–4; **stopped before
  stage 5** (see below).
- **§1 coverage width mode**: `widthMode` option, default `'equal-risk'`
  (unchanged), new `'coverage'` = greedy water-fill over each column's
  upper concave envelope (`coverageWidths` + `concaveEnvelope` in
  util.js; solveWidths gained a `mode` arg, equal-risk body verbatim).
  Wired JS option / `grid.setWidthMode` / python `width_mode` / viewer
  `?widths=coverage` + a navbar **Fit: Balanced | Maximize** segmented
  control (two labeled states, not a toggle). 6 new smoke checks (164
  total): coverage shows more full cells than equal-risk on a
  thin-vs-thick fixture, respects budget, agrees in the tight/floors
  regimes.
- **§2 bounded height**: grid `maxRows` (measures rendered row height) /
  `height` (raw CSS); python `rows` / `max_height`. Vertical scroll, not
  pagination.
- **§3 dark mode**: grid.css colors → CSS custom properties on `.csvgrid`;
  `prefers-color-scheme: dark` block + `[data-theme]` override. Fixes the
  JLab white-island header (sticky bg now `var(--csvgrid-bg)`). Viewer
  sets Bootstrap `data-bs-theme` inline in `<head>` (no flash) + chrome
  uses `--bs-*` vars; `bg-white/bg-light/text-dark` → `bg-body/
  bg-body-tertiary/text-body`.
- **§4 responsive**: navbar collapses `.btn-label`s to icons below `lg`,
  wraps as last resort; grid toolbar uses CSS container queries
  (`container-type: inline-size` on `.csvgrid`).
- **§5 file handlers**: I stopped here — plan wanted csv/tsv/tab/txt but
  3.0.6 had deliberately narrowed to .csv (Chromium registers ALL declared
  handlers; no install-time per-extension opt-in). Steve chose **csv +
  tsv + tab** (excl. txt/md). Manifest now has one entry per extension so
  any can be dropped cleanly. In-app browse still accepts all formats.
- **§6 docs**: python `show()` docstring expanded into the full enumerated
  options reference; READMEs + grid header comment updated.
- dist rebuilt + python assets refreshed; version 3.1.0 in the 3 JS
  places + python. CHANGELOG 3.1.0 covers the whole plan. **3.1 done:
  Steve tested (incl. light/dark), committed; plan moved to dev/done.**

## 2026-06-13 — 3.1 drafting started (meta-planning)

- Draft at dev/plan-3.1-options-responsive-fileassoc.md. Decisions
  locked: option names UNCHANGED (the fuzzy-box + col-filter toggles
  Steve wanted ALREADY exist as global_search/column_filters);
  rows/max_height (compact bounded-height scroll, NOT pagination); dark
  mode IN (auto via prefers-color-scheme — fixes the JLab white-island
  header bug); responsive both toolbars (principle: "not embarrassing on
  a phone" — currently bad); granular per-extension file handlers (text
  only). **parquet/feather DROPPED — Steve said yell again if raised.**
  export-view + column-stats parked (§7). The headline item: a width-
  allocation upgrade (§1). NOT a replace — BOTH methods kept, selectable
  via `width_mode` (default equal-risk, no regression); new `coverage`
  option = greedy water-fill over each column's concave envelope
  (complete cheap thin-tail cols, truncate thick-tail outliers). Wired
  through JS option / python show() / viewer `?widths=` URL; same
  measureLayout output so mode-switch is re-solve-only. DECIDED: default
  equal-risk; viewer gets BOTH the ?widths= URL and a labeled navbar
  segmented control ("Fit: balanced | maximize"), which must be
  width-sensitive (collapses on phone, part of §4 responsive work).
  Staging proposed, width-upgrade first. Plan fully specified; NOTHING
  started — awaiting Steve's go to execute.

## 2026-06-13 — Steve declares the 3.0 arc DONE

- All plans (1.2 through 3.0) moved to dev/done/; dev/ has no open
  plans. Steve: "seriously happy camper" — double-clicking csvs opens
  the viewer, JL and the Quarto blog both render the grid. Feature
  freeze is lifted; next work starts a fresh plan doc.

## 2026-06-13 — blog/JLab embedding bugs fixed (v3.0.7)

- Steve's hacks/index-from-blog-copy.qmd rendered an EMPTY grid; same
  code fine in Jupyter; JLab text right-aligned (his "big bugaboo").
  Diagnosed by reproduction (quarto render + injected onerror trap):
  1. Quarto pages carry RequireJS → define.amd hijacks the umd wrapper
     → window.CsvGrid never set. Fix: dist/csv-grid.iife.js (plain
     global), now THE script-tag artifact; python emitter uses it.
  2. JLab css `:not(.jp-RenderedMarkdown).jp-RenderedHTMLCommon td
     {text-align:right}` beats `.csvgrid-table .col-text` by one point
     (:not counts as a class). Fix: cell rules scoped
     `.csvgrid .csvgrid-table …`. Canary: dev/jlab-align-test.html.
- Both verified: re-rendered qmd shows the full 1081-book grid; JLab
  rule simulated verbatim → alignment correct. v3.0.7 everywhere;
  Steve to commit, deploy, twine-publish 3.0.7.
- (3.0.6 same day: file handler narrowed to .csv only; PyPI changelog
  link fixed — repo default branch is master, not main.)

## 2026-06-12 — naming settled + PWA file handling (v3.0.5)

- Steve: no attachment to names, **strong attachment to consistency**.
  Final scheme: csv-viewer = app/repo/Pages; csv-grid = the component
  EVERYWHERE (CsvGrid class, npm, dist files, .csvgrid-* css, PyPI
  dist, csv_grid import). PyPI package renamed csv-viewer → csv-grid
  pre-publication (both free; checked). READMEs cross-link both ways.
- PWA file handling: manifest file_handlers (.csv .tsv .tab .txt .md)
  + launchQueue consumer → installed app shows in Windows "Open with"
  and can be the default .csv app. Steve deploying to Pages + will
  publish to PyPI himself — **via twine + ~/.pypirc** (his standing
  workflow; a [csv-grid] section alongside agg/gter), not uv publish:
  `cd python; uv build; twine upload -r csv-grid dist/*`.

## 2026-06-12 — stages 5+6 executed: python emitter + docs (v3.0.4)

- **python/csv_grid** (uv project): show(df)/to_html(df)/payload(df);
  assets inlined once per page (copies live in the package, refreshed
  by npm run build); snake_case options, fmt aliases formats; dates →
  ISO, NaN → blank, integral floats → ints; NO dtype→format hints —
  grid inference stays authoritative (small deviation from plan
  wording, flagged). Round-trip: dev/python-payload.json → smoke test
  normalizeRecords (158 checks); fixture dev/embed-test-python.html
  (generated, self-contained) verified by screenshot.
- Docs rewritten: README (two-halves framing, CsvGrid quick start),
  CLAUDE.md (overview/commands/architecture: serve required, rebuild
  dist after src/grid changes, version in three places), python README.
  Post-3.0 deferrals (app bundling + Pages Action) noted in plan doc.
- Steve is enabling GitHub Pages (main/root) — installable PWA URL
  https://mynl.github.io/CSV_Viewer/ (now in README).
- Same session: **MIT LICENSE** (root + python/ copy); pyproject made
  PyPI-ready — distribution name **csv-viewer** (free on PyPI, checked;
  import stays csv_grid), Python ≥ 3.11, full metadata; `uv build`
  wheel verified (module + assets + license). Publishing itself still
  Steve's trigger (`uv publish` + token).
- **Icon bug found & fixed**: 192 + apple-touch had the glyph slid off
  canvas since 2.1.1 — Windows clamps headless-Edge window width at
  ~340px, so small --window-size crops a wider centered layout. Now:
  render 512, downscale via System.Drawing (dev/icon-build/README.md).
- **3.0 arc code-complete**; plan stays in dev/ until Steve says done.

## 2026-06-12 — stage 4 redone with REAL Vite (v3.0.3)

- Steve: "I do want this bundled" — concat build replaced. Decisions
  (his): drop file:// (always serve; `python -m http.server 8080`),
  Vite = library build only (viewer stays no-build, native ES modules).
- Source is ES modules now: core.js (exports), NEW util.js (pure
  display logic, the tested surface), grid.js (entry, default-exports
  CsvGrid only — keeps the UMD global a class), module worker, one
  `<script type="module">` in index.html. Smoke test imports directly
  (vm harness gone), 151 checks.
- Build: `npm run build` = two Vite passes (es, then `--mode umd`).
  Rolldown can't express import.meta.url in UMD → define+intro
  currentScript polyfill + renderBuiltUrl for the worker asset (Vite's
  own helper reads currentScript lazily = null → would resolve the
  worker against the page; caught via the dev/-vs-dist/ fixture).
- Verified: viewer (native ESM), embed UMD, embed ESM, both worker
  fixtures (source + dist cross-directory). Awaiting review + commit;
  stage 5 (python emitter) then 6 (docs — incl. the new serve-required
  reality and three version spots) remain.

## 2026-06-12 — 3.0 stage 4 executed (library build, v3.0.2)

- `dist/` committed: csv-grid.{es,umd}.js, csv-grid.worker.js (self-
  contained), csv-grid.css. **Deviation flagged: NOT Vite** — sources
  are plain scripts sharing globals (that's what keeps dev build-free),
  so a module bundler would break them; instead `node dev/build.mjs`
  (zero deps, no node_modules): concatenate + wrap + rewrite two marked
  lines in grid.js (worker discovery: currentScript → import.meta.url
  for ESM; worker filename → csv-grid.worker.js). package.json maps
  main/module/exports to dist for aggregate_api's `file:` dependency.
- Version now in three places: app.js VERSION, sw.js cache name,
  package.json. Rebuild dist after grid/core source changes.
- Green: 151 smoke checks (incl. Node-importing the dist ES bundle);
  screenshots — embed-test (UMD, http + file://), embed-test-es (ESM),
  worker-test-dist (bundle finds its worker, 2 MB off-thread parse),
  viewer unchanged at v3.0.2. Awaiting review + commit; stages 5–6 next.

## 2026-06-12 — 3.0 stages 2+3 executed (options + own CSS, v3.0.1)

- Full v1 API: `new CsvGrid(elementOrSelector, data, options)`; data
  {csv}/{records, columns}/{url}; options toggles + align + formats
  (`[,][.N](f|d|%|e|s)`, 'year', 'eng') + renderCap/eagerCells/worker/
  headerMode; setData returns a promise (superseded loads never settle);
  destroy(). Worker mgmt moved INTO the grid (currentScript-relative
  worker URL). Grid generates its own `.csvgrid-*` DOM styled by
  grid.css — no Bootstrap inside; styles.css split into grid.css +
  app.css. Viewer = thin chrome passing
  {globalSearch:false, expandButtons:false, statusBar: footer element}.
- Two deliberate notes for review: (1) `headerMode` also accepted
  per-load in the data object — the header toggle re-parses without
  destroy/recreate jank; (2) grid keeps the small control-method surface
  (setGlobalFilter/clearFilters/expand/contract/applyLayout) for the
  viewer's navbar, beyond the plan's "setData, destroy" minimum.
- Green: 148 smoke checks; screenshots — viewer pixel-faithful,
  dev/embed-test.html (two grids, bare page), dev/worker-test.html
  ({url} + 2 MB worker parse). Awaiting Steve's review + commit.

## 2026-06-12 — 3.0 stage 1 executed (instance-ification, v3.0.0)

- Mechanical split, zero behavior change: `src/grid/{core,grid,worker}.js`
  + `src/app/app.js` (chrome). `CsvGrid` class owns all grid state;
  chrome feeds it `processData` results and calls
  `setGlobalFilter/clearFilters/expand/contract/applyLayout`. `sw.js`
  cache bumped to v3.0.0 with the new shell paths.
- Green: 120 smoke checks pass; headless-Edge screenshot of
  `?src=dev/sample.csv` matches 2.1.1. Awaiting Steve's commit; plan
  stays in `dev/` (stages 2–6 to go).

## 2026-06-12 — 3.0 GO: option B approved, plan written

- Steve: "pretty clear I want option B, go straight to 3.0" — the YELL
  was right; this is transformation, not whim. Plan at
  **dev/plan-3.0-grid-extraction.md**, written to survive a /clear
  (context snapshot inside). Six stages: instance-ify → options
  (align/formats) → self-contained CSS → Vite lib build (dist/
  committed) → python/csv_grid emitter → docs. Feature freeze on the
  viewer during the arc. Consumer playbooks included but NO code outside
  this repo.
- FYI from Steve: greater_tables' differentiator = twin static HTML +
  LaTeX (custom tikz), multiindex/rules control; all static, a bit of a
  cluster, ripe for refactor. Complementary to the grid (interactive),
  not competing. A someday-idea: GT's HTML flavor could emit the grid.

## 2026-06-12 — reusable grid: option space (discussed, NOT executed)

- Goal: use the grid in Steve's other pages (qmd/Python-served) for
  CSV/DataFrame display, with control over global search / column
  filters, per-column alignment ("llrrclrr"), per-column number formats
  (f-string-like specs).
- Options: (A) iframe of the app + config query params + tiny Python
  emitter — days, zero app risk, recommended as 2.2; (B) extract real
  CsvGrid component, app becomes first consumer — the 3.0 arc, 2–4
  sessions, natural Vite/lib-build moment; (C) progressive enhancement
  of static greater_tables HTML — complementary someday, not main road;
  (D) <csv-grid> web component — cheap sugar after B.
- Format spec: accept Python/d3-style strings (,.2f .1% d) — ~40-line
  JS subset parser; overrides auto rules per column. Alignment spec maps
  onto existing col.align plumbing.
- Repo: grid extracted INSIDE this repo (src/grid/) until API stabilizes
  + second consumer exists, then split to own repo with semver; viewer
  consumes grid. Python emitter via uv path sources (aggregate_api
  co-dev pattern).
- Consumer ranking (Steve, 2026-06-12): #1 aggregate_api (interactive
  SPA — effectively REQUIRES option B, the real component; promotes
  extraction to the actual goal); #2 blog qmd pages (Reading-Since-1990
  at C:/s/TELOS/Blog/quarto/ConvexConsiderations/...). Vite library mode
  = the extraction milestone (emits es + umd + css; consumers need no
  build). Grid is fully self-contained JS (no DataTables/AG-Grid etc.);
  Bootstrap is app-chrome cosmetics only and stays out of the embedded
  grid.

## 2026-06-12 — v2.1.1: year bounds + phone icons

- Year auto-detect was literal-spec `1800 < x < 2030` (so 1801–2029);
  Steve's 1990–2030 column failed on the boundary. Now **1800–2100
  inclusive** (pinned formatting rules below updated).
- PWA icons for phones: manifest 192/512 PNG + maskable 512 (white on
  brand blue), apple-touch-icon 180 for iOS. Rendered from the real
  glyph via headless Edge; wrapper pages kept in dev/icon-build/.

## 2026-06-11 — v2.1.0: worker + src/ restructure

- Web Worker now parses+infers files ≥ 1 MB off the main thread (status
  bar shows progress); small files stay synchronous; file:// falls back
  gracefully. The last main-thread freeze is gone.
- Source git-mv'd into Vite-shaped layout: `src/{core,app,worker}.js` +
  `src/styles.css`; `core.js` is the pure shared half (page + worker).
  index.html, favicon, manifest, sw.js stay at root (sw scope). Still
  zero-build; Vite migration notes in dev/plan-2.1.

## 2026-06-11 — v2.0.0: the speed release

- Steve approved sampling ("beautiful, more actuarial"), deferred search,
  lazy formatting; worker/Vite pended. Named 2.0.0 for the big internal
  change.
- Plot twist: benchmarking exposed that the 250K wall was a CRASH —
  `Math.max(...250K-element spread)` blows the JS call stack. Plus two
  hidden taxes: per-call `Intl.NumberFormat` construction (cached now;
  full format 52s → 1.5s) and double date-parsing (single now; infer
  4.9s → 2.0s).
- Net: 250K×6 loads in ~2.5–3s (was: crash), formatting at load 68ms,
  search index builds in background chunks with status-bar progress.
  Small files (≤200K cells) byte-identical behavior.
- Answers to Steve's design questions: yes — below the threshold
  everything is eager exactly as before; chunking applies to the search
  index (10K rows/chunk, yields to UI), while display formatting needs no
  chunks (on-demand touches only rendered rows).

## 2026-06-11 — v1.5.1: status bar lower left

- File name / row counts / showing-N moved to a fixed lower-left status
  bar; duplicate version line in the old footer dropped (version stays
  top left). Next up per Steve: the speed-up ideas below (sampling,
  deferred search index, worker) — NOT bundling.

## 2026-06-11 — 250K-row limit + the Vite question (discussed, NOT executed)

- Steve hit a limit on a 250K-row synthetic df. Diagnosis: main-thread
  load work — parse, inference, formatted cache, search strings, and
  (prime suspect) `measureText` over every cell in `measureLayout`.
- Key fact: Vite = bundling = organization, NOT runtime speed. Zero help
  for this.
- Fix order when Steve says go: (1) sample width measurement (~2K rows
  per column — percentiles from a sample, tiny change, likely the big
  win); (2) defer search-string building to first search; (3) Web Worker
  for parse+inference (possible without a build; Vite merely nicer).
  Adopt Vite at the worker step if at all.
- Drop-to-replace: already works, Steve amused; do nothing. Tabs:
  rejected — browser has tabs. DONE.

## 2026-06-11 — ideas discussed, NOT executed (Steve's orders)

- **Drop-to-replace**: already works (v1.0 accepts drops anywhere,
  including the table view) — just lacks a visual cue. Polish = ~20-line
  overlay, a future 1.5.x.
- **Tabs**: medium yell. ~120–180 lines (state-array + global swap +
  tab-strip chrome); no speed cost, but memory ×3–4 per open file, and a
  drop-semantics conflict with drop-to-replace (replace current vs open
  new). Pushback: browser/PWA tabs already do this. Verdict pending
  Steve's actual usage.

## 2026-06-11 — v1.5.0: markdown pipe tables

- Markdown tables open everywhere CSVs do; alignment follows the
  `|:--|:-:|--:|` separator spec (overrides type alignment; bare `---`
  defers to the viewer). ~50 lines, no speed impact.
- **New standing principle (recorded in CLAUDE.md + claude-generic.md):
  YELL if an ask is involved** — big code-size or speed cost means stop
  and tell Steve first; his need for speed outweighs occasional whims.

## 2026-06-11 — v1.4.1 / v1.4.2: sci-notation fix, column drag-resize

- 1.4.1 (committed): `1e-03` etc. now parse as numbers (one such value
  was demoting whole columns to text).
- 1.4.3: Expand/Contract as two separate buttons — UI principle for this
  project (and generally): **no buttons that change meaning** (the
  infamous play/pause). Contract = back to fitted layout, clears dragged
  widths.
- 1.4.2: drag-resize grips on header edges + double-click-to-fit-content.
  Steve's take, agreed: resizing is a crutch — the machine should get
  widths right — but it's expected in this kind of app, and double-click
  covers the real use case (one wide column to inspect).

## 2026-06-11 — v1.4.0: header toggle, liberal dates, money 2dp

- v1.3 committed by Steve. v1.4
  (dev/plan-1.4-header-toggle-dates-money.md): "Row 1 = header" toolbar
  toggle (re-interprets loaded data either way); liberal date recognition
  with per-column US/UK disambiguation; money rules (header or value)
  forcing 2dp ahead of the clever float rule; BOM + leading-blank-line
  stripping (fixes the bank download that loaded as one column).
- Formatting rules now pinned at the top of this file — Steve's tracker.
- Test fixture: dev/sample-bank-uk.csv (BOM, blank lines, day-first).

## 2026-06-11 — v1.3.0: browse, headerless bank CSVs, expand toggle

- v1.2 committed by Steve. v1.3 (dev/plan-1.3-browse-headers-expand.md):
  explicit Browse button on the ingest card, centered header version,
  headerless-CSV detection (first row contains a number/date → data) with
  type-guessed names (Date / Amount / Description / Year, numbered), and
  a sticky toolbar Expand toggle (natural widths + horizontal scroll,
  bypassing the equal-risk squeeze).
- Install-as-app recipe: serve (`python -m http.server 8080`), open
  http://localhost:8080 in Edge, install icon in the address bar (or
  … menu → Apps → Install). After first load the service worker keeps the
  shell working even when the server is down.

## 2026-06-11 (late night) — v1.2 job lot: ?src=, PWA, plan renames

- Verdict so far: gummage.
- Plan naming convention now `plan-<version>-<desc>.md`; all three plans
  renamed (1.0-initial-viewer and 1.1-fuzzy-and-widths in dev/done;
  1.2-formatting-keyboard-pwa active). Convention recorded in CLAUDE.md
  and claude-generic.md.
- `?src=<url>` loader added (auto-loads a CSV from the query string) —
  the enabler for embedding in the blog post via iframe.
- PWA added: manifest + service worker (offline app shell, installable
  from Edge on localhost/https). Steve knows PWA ≠ file association — he
  just likes and uses PWAs. `?src=` data is never cached. File
  association (`file_handlers`/`launchQueue`) deliberately not wanted.
- All in v1.2.0; Steve tests and commits the job lot.

## 2026-06-11 (night) — v1.2.0 shipped: formatting, keyboard, chrome

- Formatting spec = greater_tables (Steve is **very** anal about
  formatting; recorded in CLAUDE.md): integers comma'd, years plain
  (header year-ish or all values 1800–2030), engineering format for
  wide-ranging floats, dates ISO **center-aligned**.
- White-whale "sensible float format" candidate adopted: per-column
  uniform decimals = min(observed precision, 3 − floor(log10(mean |x|))),
  clamped 0–6 — ~4 significant digits at typical magnitude. Awaiting
  field verdict.
- Also: Ctrl+O open, Esc clears filter boxes, bi-table SVG favicon,
  version under the header brand, table font 0.8rem. v1.1 plan moved to
  dev/done; v1.2 in dev/plan-1.2-formatting-keyboard-pwa.md.
- **Blog embedding** (Reading-Since-1990 page, replacing ITables): yes,
  once stable — needs a `?src=<url>` CSV auto-load param, then iframe (or
  copy the three files into the post resources). Future plan.
- **When to "app" it** (Windows default .csv handler): PWA route — web
  manifest with `file_handlers` + service worker, install via Edge, set
  as default in Windows; `launchQueue` delivers the double-clicked file.
  Needs localhost/https serving, so it pairs with the move-to-build
  trigger (first npm dependency / Web Worker / xlsx-Parquet ingest).
  Candidate v1.3.

## 2026-06-11 (evening) — v1.1.0 shipped

- Author committed v1.0 as the baseline; plan-1.0-initial-viewer moved to `dev/done/`.
- v1.1.0 executed from `plan-1.1-fuzzy-and-widths.md` (now in `dev/done/`):
  fzf-style fuzzy global search (score-ordered when unsorted) and tight /
  equal-risk column widths. Widths frozen per load at the full-table
  layout — author explicitly does not want live width changes while
  filtering; re-solve on window resize only.
- Build question: stay zero-build until the first real npm dependency or
  Web-Worker need (xlsx/Parquet ingest, very large files); v1.x polish
  doesn't justify the move.

## 2026-06-11 (later still) — v1.0 verdict and v1.1 ideas

- v1.0 verdict: fantastic, just what was wanted.
- v1.1 designed (`dev/done/plan-1.1-fuzzy-and-widths.md`, awaiting go-ahead): fzf-style fuzzy
  matching in the global search (scored subsequence, fzf extended syntax
  subset), and tight columns by default with "equal-risk VaR" width
  allocation when the table is wider than the screen — every column
  truncates with equal probability; low-sd columns show fully.
- The width-allocation ↔ capital-allocation connection is a paper idea —
  logged in `../TODO.md` (new cross-project ideas file).
- Author bio added to CLAUDE.md and claude-generic.md: PhD in math,
  actuary, geeky — lead with the mathematical framing.

## 2026-06-11 (later) — clarifications

- Zero-build is not a requirement: a Vite/npm SPA (like aggregate_api/web)
  is fine, and the app could be served from one of Steve's web servers —
  but local to his machine is preferred. v1.0 stays zero-build; move to
  Vite only when a real dependency (virtual scroll, Excel/Parquet) earns it.
- gummage corrected: "is or would be perfection" (Chandler: "gum would be
  perfection") — praise, not housekeeping.

## 2026-06-11 — project start, v1.0.0

- Motivation: no existing CSV viewer is acceptable; a vanilla JS/HTML SPA
  is easy to knock out and fully controllable.
- v1.0 requirements: ingest via open/paste/drag box (modeled on the
  archivum `/ingest` page), filtering like the ITables table on the
  Reading-Since-1990 blog post, column sorting, sensible number formats,
  date awareness, numbers right / text left, autosizing columns.
- Built as three files — `index.html`, `app.js`, `styles.css` — no build
  step, no dependencies (Bootstrap via CDN for looks only). Hand-rolled
  RFC 4180 parser with delimiter sniffing; strict all-or-nothing column
  type inference.
- Plan lives in `dev/plan-viewer.md`; stays out of `dev/done/` until the
  author says so. We will iterate. Author handles all git commits.
- Process updates this session (also backfilled to `claude-generic.md`):
  descriptive plan names (`plan-<desc>.md`, not numbered); every project
  keeps a `human-hints.md`; `UV_LINK_MODE=copy` only needed on the T:
  drive; steve-terminology (SWIM, AQIN, gummage) recorded.
