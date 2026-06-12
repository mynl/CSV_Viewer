# plan-3.0-grid-extraction — CsvGrid embeddable component, Vite lib, Python emitter

Approved by the author 2026-06-12 ("pretty clear I want option B, go
straight to 3.0"). YELL-grade by design: this transforms functionality.
**All work is constrained to this repo.** Changes to consumers
(aggregate_api, blog) are DESCRIBED in the playbooks at the end but their
code is never touched from here.

## Context snapshot (read this after a /clear)

- Current version 2.1.1; smoke test `node dev/smoke-test.mjs` = 120
  checks, all passing. App works served (`python -m http.server 8080`)
  or from `file://` (worker falls back to sync).
- Layout: `index.html` + root statics (`sw.js`, `favicon.svg`,
  `manifest.webmanifest`, `icons/`) + `src/{core,app,worker}.js`,
  `src/styles.css`.
- `src/core.js` is pure/DOM-free (parse, dates, inference,
  `processData`) and is loaded by both page and worker — it moves into
  the grid package essentially unchanged.
- `src/app.js` is the refactor target: a module-global `state` object,
  document-level listeners (drop, paste, Ctrl+O), DOM-id wiring
  (`$('data-table')` etc.), Bootstrap classes for chrome. One grid per
  page, by construction.
- Formatting rules (year/money/eng/white-whale float) are pinned at the
  top of `human-hints.md`. Author conventions in `CLAUDE.md` (notably:
  author commits, YELL, version bumps incl. `sw.js` cache name, plans
  stay in `dev/` until he says done).
- Why 3.0: consumer #1 is **aggregate_api** (interactive SPA — cannot
  iframe per-pane; needs a real component); #2 is blog qmd pages
  (Reading-Since-1990, currently ITables). greater_tables is the
  author's STATIC table package (HTML+LaTeX/tikz twins, multiindex
  rules) — complementary, not competing; do not absorb or imitate it.

## Target architecture

```
csv-viewer/
  index.html                viewer app shell (first consumer of the grid)
  sw.js, favicon.svg, manifest.webmanifest, icons/    (root, as now)
  package.json, vite.config.js                        (stage 4)
  src/
    grid/                   THE LIBRARY (self-contained, no Bootstrap)
      core.js               pure data logic (moved, content unchanged)
      grid.js               CsvGrid class — render, sort, filter, widths,
                            lazy format, search index, worker mgmt
      grid.css              namespaced .csvgrid-* styles
      worker.js             parse worker (importScripts core.js)
    app/
      app.js                viewer chrome: ingest cards, drop/paste/Ctrl+O,
                            header toggle, Open button, PWA, ?src=
      app.css               chrome-only styles (Bootstrap stays here)
  dist/                     built artifacts, COMMITTED so consumers can
                            copy without building: csv-grid.es.js,
                            csv-grid.umd.js, csv-grid.css, csv-grid.worker.js
  python/                   csv_grid emitter package (uv project)
    pyproject.toml
    src/csv_grid/__init__.py    show(df, ...), to_html(df, ...)
  dev/                      plans, fixtures, smoke test, embed-test pages
```

## CsvGrid API (v1 — keep minimal, resist hooks/events)

```js
const grid = new CsvGrid(elementOrSelector, data, options);
```

- `data`: `{ csv: string }` | `{ records: [...], columns: [...] }` |
  `{ url: string }` (fetched; errors surface in the grid).
- `options` (all optional):
  - `globalSearch: true` — fzf search box
  - `columnFilters: true` — per-column filter row
  - `sortable: true`
  - `statusBar: true` — row counts line
  - `expandButtons: true` — Expand/Contract pair
  - `align: 'llrrcr'` — per-column l/r/c, overrides type defaults
    (rides the existing markdown `col.align` plumbing)
  - `formats: [',.0f', null, '.1%', ...]` — Python/d3-style spec per
    column, null = auto rules. Spec subset parser (~40 lines):
    `[,][.N](f|d|%|e|s)` plus `'year'`/`'eng'` named formats. Date
    display stays ISO (date format specs are explicitly out of scope).
  - `renderCap`, `eagerCells`, `worker: true|false|url`
  - `headerMode: 'auto'|'first-row'|'headerless'`
- methods: `setData(data)`, `destroy()`. Nothing else in v1.
- Multiple instances per page MUST work: no module-global state, no
  document-level listeners inside the grid, no element ids (classes +
  per-instance root element). Keyboard (Esc-clears-filter) binds to the
  grid root; Ctrl+O/drop/paste belong to the viewer app, not the grid.

## Stages — each ends green (tests + manual fixture), author commits

**Stage 1 — instance-ification (3.0.0).** Mechanical: `state` + render +
filter/sort + layout + lazy/index machinery become a `CsvGrid` class in
`src/grid/grid.js`; `core.js` moves to `src/grid/`; `app.js` becomes
chrome that instantiates one grid and feeds it `processData` results.
Grid still renders into the existing markup initially. NO feature or
behavior change. Smoke test harness updated for new paths (pure
functions unchanged). Exit: app behaves identically; 120 checks pass.

**Stage 2 — options surface (3.0.x).** Toggles (search/filters/status/
expand/sortable), `align` spec, `formats` spec parser + per-column
override of the auto rules. Viewer passes defaults so nothing visible
changes. Unit tests for the spec parsers and overrides. Exit: a console
`new CsvGrid(el, {csv}, {globalSearch:false, align:'llr'})` behaves.

**Stage 3 — style self-containment.** Grid generates its own toolbar/
filter-row/status DOM with `.csvgrid-*` classes styled by `grid.css`
(no Bootstrap inside the grid; ~150 lines, replicate current look).
Viewer app keeps Bootstrap for its chrome only. Exit: grid renders
correctly on a bare page with only `grid.css` (fixture
`dev/embed-test.html`); viewer looks unchanged.

**Stage 4 — Vite library build.** `package.json` + `vite.config.js`
(lib mode): emits `dist/csv-grid.es.js`, `.umd.js`, `csv-grid.css`,
`csv-grid.worker.js`. Source stays plain-script-loadable so the viewer
keeps working with NO build during development (scripts tags as now);
`dist/` is committed. Worker note: umd consumers must host the worker
file next to the bundle or pass `worker:false` (sync — fine for the
small tables consumers show). Exit: `dev/embed-test.html` runs against
`dist/` artifacts; viewer unchanged.

**Stage 5 — Python emitter (`python/csv_grid`).** `show(df, **opts)`
for qmd/Jupyter (IPython display; script tag deduped per page; data
inlined as JSON records; NaN → ''), `to_html(df, **opts)` returning a
fragment for static generation. `assets=` parameter: 'inline' (embed JS
+ CSS once), or a base URL. Maps pandas dtypes to align/format hints
but the grid re-infers from data as usual. uv project; local path
install. Exit: a generated fixture `dev/embed-test-python.html` renders
correctly; round-trip test of the JSON payload in the smoke test.

**Stage 6 — docs.** README (library + app halves), CLAUDE.md
architecture/commands rewrite, human-hints, CHANGELOG. Version 3.0.x
final; `sw.js` cache bump (shell paths change in stage 1!).

## Consumer playbooks (descriptions only — NEVER edit from this repo)

- **aggregate_api**: its `serializers.py` already emits
  columns/records-shaped JSON (`FrameResponse`). Web side adds
  `csv-grid.es.js` as a dependency (copy `dist/` into `web/vendor/` or
  npm file: dependency), replaces the current table renderers with
  `new CsvGrid(pane, {records, columns}, {statusBar:false, ...})`.
  Small DataFrames → `worker:false`. Done in that repo, on its own
  plan/version.
- **Blog (Reading-Since-1990 and friends)**: copy `dist/csv-grid.umd.js`
  + `csv-grid.css` into the Quarto project resources once; qmd python
  cell: `from csv_grid import show; show(df, align='llrcr',
  fmt=[None,None,',d','%Y',',.2f'])`. Replaces ITables include.
  csv_grid installed in the blog's uv env from this repo's `python/`.
- **Viewer app**: already converted in stages 1–3; `?src=` keeps working
  throughout (it is the interim blog answer and a regression canary).

## Risks / standing cautions (also discussed in chat 2026-06-12)

1. Daily-driver regression — stage discipline, fixtures, author commits
   between stages; never two stages in one working tree.
2. Worker pathing under bundling — the known sharp edge of stage 4;
   fallback `worker:false` always available.
3. Feature freeze during the arc — no new viewer features until 3.0
   lands (rebase pain otherwise).
4. Grid look after Bootstrap removal — grid.css must replicate the
   current table/toolbar look; compare against v2.1.1 screenshots.
5. PWA cache: shell paths change in stage 1 AND stage 4 — bump `sw.js`
   cache name each stage; hard-refresh after deploys.
6. Multiple grids per page = full data copy per grid (fine for consumer
   table sizes; the 250K case is the viewer's, which stays single).
7. Out of scope, explicitly: date format specs, virtual scrolling,
   xlsx/Parquet, GT-style LaTeX output, repo split (revisit when
   aggregate_api consumes it and the API has been stable a few weeks),
   npm/PyPI publishing.

*Stays in `dev/` until the author says it is done.*
