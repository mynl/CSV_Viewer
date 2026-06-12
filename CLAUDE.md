# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with
code in this repository.

## Project Overview

`csv-viewer` is a CSV viewer + embeddable grid in vanilla JS — born of
the author finding no existing CSV viewer in any way acceptable. Two
halves, one repo (since 3.0):

- **App** (`index.html` + `src/app/`): single-page viewer — drag/drop,
  browse, or paste CSV and get a sortable, filterable, properly
  formatted table. Bootstrap 5 via CDN for the chrome only.
- **Library** (`src/grid/` → committed `dist/`): `CsvGrid`, the same
  grid as a self-contained component — no framework, namespaced
  `.csvgrid-*` CSS, no element ids or document-level listeners,
  multiple instances per page. Consumers: aggregate_api, blog qmd pages
  (via `dist/` and the `python/csv_grid` emitter).

Type-aware columns (number / date / text), thousands separators, dates
ISO, numbers right-aligned, equal-risk autosized columns. The source is
ES modules run natively: **no build step in development, but a server is
required** — `file://` will not load module scripts. Vite bundles the
library only; the app itself is never bundled (source = where we live,
dist = what we hand to consumers). Look and feel follows the author's
archivum apps.

A private side project, iterated at a relaxed pace.

Author: Stephen J. Mildenhall — PhD in math, actuary, geeky. Lead with the
mathematical framing; quantitative formulations (optimization, probability,
risk measures) are welcome and often the intended design language.

## Working with the author

These rules apply in every project — follow them without being re-asked.

- **The author handles all git commits. Do not commit.** To check status, read
  the git log; if an expected commit is missing, mention it.
- **Diagnose / design / propose before editing source or tests.** Don't change
  code until told to proceed ("go ahead"). "Can you see the issue?" means
  explain, not fix.
- Environment is **PowerShell on Windows**. No `awk`/`sed`/`head`/`tail` (even
  via the Bash tool). Use `rg` + the Read/Edit/Write tools.
- Prefer explicit, documented recipes over magic / auto-install behavior.
- UI: no buttons that change meaning with state (the infamous play/pause)
  — use separate, explicitly-labeled actions instead.
- **YELL if a request is involved.** The author assumes his asks are easy.
  If one implies a big increase in code size or a decrease in speed, do
  NOT just build it — say so first and let him decide. His need for speed
  outweighs his occasional whims.
- Keep rendered output tight — no gratuitous blank lines in blocks.
- US spelling throughout (prose, docstrings, comments, identifiers).
- **Keep `human-hints.md` current** — a very high-level summary of what we
  discuss and decide, newest first. Update it at the close of each working
  session.
- Periodically remind the author to stop biting his tongue.

## Steve-terminology

- **SWIM** — "see what I mean": you have enough context; fill remaining gaps
  sensibly rather than asking.
- **AQIN** — "ask questions if needed": on genuine ambiguity, ask rather than
  guess.
- **gummage** — is or would be perfection. From Chandler Bing, stuck in a
  vestibule with a pretty woman during a power outage, offered a stick of gum:
  "gum would be perfection." High praise: "that's gummage" = exactly right.

## Commands

Runtime has zero dependencies; Vite is the only devDependency (library
build). `python/` is a uv project (this repo is on C: so default
hardlink mode is fine — `UV_LINK_MODE=copy` is only for the T: drive).

**Run the app** (a server is required — ES modules don't load from
`file://`):
```
python -m http.server 8080
```

**Run the logic smoke test** (parser, sniffing, inference, formatting,
filters, format/align specs, python payload round-trip, dist
loadability — needs Node):
```
node dev/smoke-test.mjs        # = npm test
```

**Rebuild the library** after ANY `src/grid/` change (dist/ and the
python package's embedded assets are committed and do NOT auto-update;
the smoke test will NOT catch a stale dist):
```
npm run build
```

**Regenerate the python fixtures** after emitter changes:
```
uv run --project python dev/make-embed-test-python.py
```

**Test data**: `dev/sample.csv` (quoted fields, commas in values,
currency, paren negatives, ISO + US dates, blanks) for manual testing.
Fixtures: `dev/embed-test.html` (dist UMD, two grids, works from
file://), `dev/embed-test-es.html` (dist ES import, serve),
`dev/worker-test.html` / `dev/worker-test-dist.html` (worker pathing —
generate `dev/tmp-big.csv` first, recipe in the file),
`dev/embed-test-python.html` (generated, self-contained).

## Architecture

| File | Role |
|---|---|
| `index.html` | app shell: ingest view, navbar toolbar, `#grid-root`; one `<script type="module">` |
| `src/grid/core.js` | pure data logic, DOM-free: parse, sniffing, inference, `processData` |
| `src/grid/util.js` | pure display logic: format specs, `formatCell`, fzf scoring, filters, width solver, `normalizeRecords` |
| `src/grid/grid.js` | LIBRARY ENTRY — the `CsvGrid` class (DOM, state, worker mgmt); default-exports `CsvGrid` ONLY (keeps the UMD global a class) |
| `src/grid/worker.js` | module worker: parse + inference off the main thread (texts ≥ 1 MB) |
| `src/grid/grid.css` | the grid's self-contained styles, `.csvgrid-*` namespaced |
| `src/app/app.js` | viewer chrome: ingest, toolbar wiring, Ctrl+O/Ctrl+V, `?src=`, PWA registration |
| `src/app/app.css` | chrome-only styles (Bootstrap supplies the rest) |
| `dist/` | COMMITTED Vite output: `csv-grid.{es,umd}.js` + maps, `csv-grid.worker.js`, `csv-grid.css` |
| `vite.config.js` | library build, two passes (es / umd) — the UMD import.meta polyfill is explained inside |
| `python/` | uv project `csv_grid`: `show(df)` / `to_html(df)` emitters; carries copies of the umd bundle + css (refreshed by `npm run build`) |
| `favicon.svg`, `icons/`, `manifest.webmanifest` | PWA icons + manifest (root, served as-is) |
| `sw.js` | service worker — offline app shell; MUST stay at root (scope); never caches `?src=` data |
| `dev/` | plans, smoke test, fixtures, `make-embed-test-python.py` |

App pipeline: ingest (drop / browse / paste / `?src=<url>`) →
`grid.setData({csv, name, headerMode})` → grid parses (synchronous
< 1 MB, module worker above) → promise resolves → chrome switches views.
The grid owns everything from data to pixels: fzf global search +
per-column filters, type-aware sort, lazy formatting, deferred chunked
search index, sampled width measurement (see
`dev/plan-2.0-speedups.md`). Column widths solved once per load
(equal-risk VaR allocation), frozen w.r.t. filtering. The viewer passes
`{globalSearch:false, expandButtons:false, statusBar: <footer element>}`
and drives its navbar via `setGlobalFilter` / `clearFilters` / `expand`
/ `contract` / `applyLayout`; embedders get the documented surface
(`setData`, `destroy`, options) — see the header comment in
`src/grid/grid.js`.

**Version lives in three places** — `VERSION` in `src/app/app.js`, the
`sw.js` cache name, and `package.json` (stamped into the es bundle's
banner) — bump all three; `python/pyproject.toml` + `__version__`
additionally when the python package changes.

## Formatting spec

Number/date display follows the author's
[greater_tables](https://github.com/mynl/greater_tables_project)
conventions — he is **very** particular about this: integers comma-
separated, years plain (no commas), floats with uniform per-column
decimals based on typical magnitude, engineering format (SI suffixes) for
columns spanning many orders of magnitude, dates ISO and center-aligned,
numbers right, text left. Check greater_tables before inventing any new
formatting behavior.

## Documentation and code style

Vanilla JS, no framework idioms. Comment the *why* on non-obvious logic
(parsing edge cases, inference rules). The runtime stays dependency-free
— no Papa Parse, no DataTables; full control over formats and alignment
is the point of the project. The grid must keep working multi-instance:
no module-global state, no element ids, no document-level listeners
inside `src/grid/`.

## Release & housekeeping workflow

These are standing rules — follow them without being re-asked.

- **Work proceeds from plan docs**: `dev/plan-<version>-<desc>.md`
  (e.g. `plan-1.2-formatting-keyboard-pwa.md` — version then short
  description). Move a plan to `dev/done/` **only when the author says it
  is done** — not when the code lands.
- **Every plan-based code change bumps the version** (`VERSION` in
  `src/app/app.js` + `sw.js` cache + `package.json`). Pure tidying does
  not.
- **Rebuild `dist/` (`npm run build`) after any `src/grid/` change** and
  commit it with the source — dist and the python package's embedded
  assets are committed artifacts, and nothing fails automatically when
  they go stale.
- **Keep `CHANGELOG.md` current** — each version bump adds a `## <version>`
  section at the close of the iteration.
- **`README.md`** is the stable front page; touch it only when that material
  changes.
- **Keep `human-hints.md` current** (see Working with the author).
