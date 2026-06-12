# csv-viewer

A no-nonsense CSV (and markdown table) viewer in vanilla JS — and, since
3.0, an embeddable grid component. Two halves, one repo:

- **The app**: a single-page viewer. Drag a file in (or paste data), get
  a sortable, filterable, properly formatted table. Everything runs in
  the browser; nothing is uploaded anywhere.
- **The library**: `CsvGrid`, the same grid as a self-contained
  component for other pages and apps (built artifacts in `dist/`, plus
  a Python emitter in `python/` for pandas DataFrames in Jupyter and
  Quarto).

## The app

Serve the repo root and open it (the source is ES modules, which
browsers won't load from `file://`):

```
python -m http.server 8080      # then http://localhost:8080
```

Served over localhost or https it is an installable PWA
(offline-capable), and `?src=<url>` auto-loads a CSV — handy for
embeds. Drop a CSV/TSV file, click to browse, or paste data (Ctrl+V
works directly on the open screen). Markdown pipe tables are detected
automatically and honor their `|:--|--:|` alignment spec.

- Click a header to sort (again to reverse, third click to reset).
- The global search box is fzf-style: space-separated terms AND together,
  fuzzy by default (best matches first when unsorted), with `'exact`,
  `!exclude`, `^prefix`, `suffix$`, and smart case. The per-column filter
  row matches substrings, and on numeric/date columns accepts `>100`,
  `<=5`, `=3`, and `10..20` ranges.
- Numbers follow greater_tables conventions: integers get thousands commas
  (years don't), floats get uniform per-column decimals chosen from the
  column's typical magnitude, wide-ranging columns use engineering format.
  Dates are normalized to `yyyy-mm-dd` and centered; numbers align right,
  text left.
- Keyboard: `Ctrl+O` to open a new file; `Esc` clears the filter box you
  are in.
- Headerless files (bank exports) are detected and get guessed column
  names (`Date`, `Description 1`, `Amount`, …) — the "Row 1 = header"
  toggle overrides the guess either way. Leading blank lines and BOMs are
  stripped. The Expand button gives every column its full natural width
  with horizontal scroll.
- Dates in most common forms are recognized (ISO, `13/01/2024`,
  `05-Jan-24`, `Jan 5, 2024`); day-first vs month-first is decided per
  column. Money columns (by header or by value) get 2dp.
- Columns are sized tight (minimum width showing everything) when the table
  fits the window; when it doesn't, width is allocated so every column
  truncates with equal probability — widths are frozen per file load.
- Large files parse in a Web Worker (the UI stays live) with lazy
  formatting and a deferred search index.

## The library: CsvGrid

`dist/` is committed — copy the files, no toolchain needed:

| file | use |
|---|---|
| `csv-grid.umd.js` | classic `<script>` tag → global `CsvGrid`; works from `file://` |
| `csv-grid.es.js` | `import CsvGrid from …` (bundlers, module pages) |
| `csv-grid.css` | the grid's styles (self-contained, no framework) |
| `csv-grid.worker.js` | parse worker — host next to the bundle, or pass `worker:false` |

```html
<link rel="stylesheet" href="csv-grid.css">
<script src="csv-grid.umd.js"></script>
<div id="grid"></div>
<script>
new CsvGrid('#grid',
    { csv: 'name,value\nalpha,1\nbeta,2' },          // or {records, columns} or {url}
    { align: 'lr', formats: [null, ',.2f'] });        // options all optional
</script>
```

Data forms: `{csv: string}`, `{records: [...], columns: [...]}` (objects
or arrays; null/NaN → blank), `{url: string}`; plus optional `name` and
`headerMode`. Options (defaults): `globalSearch`, `columnFilters`,
`sortable`, `statusBar`, `expandButtons` (all true), `align`
(`'llrcr…'`), `formats` (per-column `[,][.N](f|d|%|e|s)`, `'year'`,
`'eng'`, null = auto rules), `renderCap`, `eagerCells`, `worker`,
`headerMode`. Methods: `setData(data)` (returns a promise),
`destroy()`. Multiple grids per page work; types and formatting are
inferred from the data exactly as in the app. As an npm dependency:
`"csv-grid": "file:path/to/csv-viewer"` resolves the `exports` map.

### Python: csv_grid

`python/` is a uv project emitting CsvGrid HTML from pandas DataFrames
(see `python/README.md`):

```python
from csv_grid import show, to_html
show(df, align='llrcr', fmt=[None, None, ',d', 'year', ',.2f'])  # Jupyter/qmd
html = to_html(df, name='results.df')                            # fragment
```

Assets are inlined once per page (or loaded from a base URL); NaN/None
become blank cells; dates are emitted ISO; the grid re-infers types.

## Development

No build step for the app — edit, refresh. The library build
(`dist/` + the Python package's embedded assets) is Vite:

```
node dev/smoke-test.mjs                              # logic tests (npm test)
npm run build                                        # rebuild dist/ after src/grid changes
uv run --project python dev/make-embed-test-python.py   # regen python fixtures
```

Fixtures in `dev/`: `sample.csv` (manual testing), `embed-test.html`
(dist UMD, two grids), `embed-test-es.html` (dist ES module),
`worker-test.html` / `worker-test-dist.html` (worker pathing),
`embed-test-python.html` (generated by the Python emitter). See
`CHANGELOG.md` for release history and `dev/` for plans.
