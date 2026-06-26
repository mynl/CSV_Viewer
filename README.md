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

**Live at <https://mynl.github.io/CSV_Viewer/>** — installable as a PWA
from there (address-bar install icon on desktop, "Add to Home Screen"
on phones). Or serve a clone of the repo root and open it (the source
is ES modules, which browsers won't load from `file://`):

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
  truncates with equal probability — widths are frozen per file load. The
  **Fit** control switches between this *Balanced* rule and *Maximize*,
  which instead shows as many cells in full as possible (completing thin
  columns, truncating thick-tail outliers); `?widths=coverage` selects
  Maximize on load.
- Large files parse in a Web Worker (the UI stays live) with lazy
  formatting and a deferred search index.

## How formatting is decided

Formatting is inferred per column from the data and the header — nothing is
configured by default. Two passes: decide each column's **type**, then pick a
display **format** for number columns. The type decision uses a sample of up
to 2048 evenly-spaced rows (so one oddball deep in a large file can't flip a
column); values are then built over every row.

**Missing values.** Blank cells and the null tokens `NaN`, `NA`, `N/A`,
`#N/A`, `null`, `none`, `-`, `--`, `.` (case-insensitive) are treated as
missing — they never influence the type and render as empty cells in
number/date columns (a text column keeps a literal `None`/`NA`).

**Type** (number / date / text), decided over the sample:

1. every non-missing value parses as a number → **number**;
2. else every one parses as a date → **date**;
3. else **text**.

Two rules force text even when the values look numeric. A **significant
leading zero** (`007`, `01234`) keeps the column text so the zero survives.
And an **integer beyond 2⁵³** (`9,007,199,254,740,991`) can't be held exactly
by a float64 — storing it as a number would silently round the digits, and
distinct values could collapse to the same double — so the column is kept
text and the digits render verbatim (a list of big primes, a 20-digit account
number). These columns still *read* as numbers, so they are right-aligned;
they sort by magnitude (not lexically) but lose the numeric `>`/`..` filters
(substring only). Floats with big exponents (`1.23e30`) are inherently
approximate and stay numbers. A value that *doesn't* parse in a column already
typed number/date (e.g. a stray bad date past the sample) is left unparsed and
shown raw — never hidden — and sorts as blank.

**Number format** — first match wins (the [greater_tables][gt] conventions):

*All-integer columns:*

1. **Year** — header matches `year|yr|vintage|cohort`, or all values fall in
   1800–2100 → plain, no separators (`1995`).
2. **Identifier** — header matches `id|no|number|account|code|zip|invoice|
   policy|…` and is *not* also a money header → plain integer, no separators
   (`100200`).
3. **Money by header** — `amount|balance|price|premium|loss|total|…` or a
   currency symbol → 2dp with separators.
4. otherwise **integer** → thousands separators, 0dp (`1,200`).

*Columns with decimals:*

1. **Percent** — a ratio/rate header (`ratio`, `rate`, `roe`, `lr`, `margin`,
   `yield`, `combined_ratio`, …) whose values are all `|x| ≤ 2` (≤ 200%) is
   read as a fraction and shown as a percentage (`0.625 → 62.5%`,
   `1.04 → 104.0%`). The `≤ 2` gate is the real guard: it keeps a column
   already in *percentage points* (a `rate` of `62`) from being multiplied
   into `6,200%`. Decimals are uniform per column = the precision the data
   carried, less the two places `×100` shifts (clamped 1–4). All-integer
   columns are skipped (units too ambiguous). Ranks above money so a *loss
   ratio* isn't grabbed by the `loss` money word.
2. **Money by header** → 2dp with separators.
3. **Money by value** — ≤ 2 observed decimals and `max|x| < 100,000` → 2dp.
4. **Engineering** — values span > 6 orders of magnitude → 3 significant
   figures with SI suffix (`4.5M`, `1.2m`).
5. **Sensible float** — uniform decimals
   `d = clamp(min(maxObservedDecimals, 3 − floor(log10(mean|x|))), 0, 6)`:
   ~4 significant figures at the column's typical magnitude, never more
   precision than the data carried.

**Dates** are recognized liberally: ISO (with optional time), numeric triples
(`d/m/y`, `m/d/y`, `y/m/d`) with `/ - .` separators and 2- or 4-digit years
(pivot at 50), and month-name forms. Day-first vs month-first is decided **per
column** — any value with a part > 12 pins the order; otherwise the default is
US `m/d/y` and the column is flagged (the viewer shows a lower-right "read as
US m/d/y (ambiguous)" note). Displayed `yyyy-mm-dd` (plus ` HH:MM` when a time
is present), centered. An invalid date (`2/30/2020`) doesn't parse, which in a
small file demotes the whole column to text.

**Number parsing** accepts `1,234.56`, `(2,500)` (parentheses = negative),
`$99.50`, `12.5%` (→ `0.125`; a trailing `%` is ×1/100), `1e-03`, and `.5`.

**Alignment.** Numbers right, dates center, text left (big-int columns,
though stored as text, are right-aligned). Decimals are uniform within a
column.

**Raw display mode.** None of this is always wanted. The **Inferred / Raw**
switch in the bottom-right of the footer flips the whole table to *Raw*: every
cell shows its source text verbatim — no separators, no ISO dates, no percent,
no engineering suffixes. Type inference still runs, so columns stay aligned and
sort correctly; only the displayed text changes (and toggling is a re-render,
not a re-parse). It is purely a view lens — independent of export, which has
its own raw/formatted choice. Default is Inferred.

[gt]: https://github.com/mynl/greater_tables_project

## The library: CsvGrid

`dist/` is committed — copy the files, no toolchain needed:

| file | use |
|---|---|
| `csv-grid.iife.js` | classic `<script>` tag → global `CsvGrid`; works from `file://` and on pages carrying RequireJS (Quarto/Jupyter outputs), which hijacks umd |
| `csv-grid.es.js` | `import CsvGrid from …` (bundlers, module pages) |
| `csv-grid.umd.js` | CommonJS `require()` consumers |
| `csv-grid.css` | the grid's styles (self-contained, no framework) |
| `csv-grid.worker.js` | parse worker — host next to the bundle, or pass `worker:false` |

```html
<link rel="stylesheet" href="csv-grid.css">
<script src="csv-grid.iife.js"></script>
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
`'eng'`, null = auto rules), `widthMode` (`'equal-risk'` default, or
`'coverage'` to maximize the count of fully-shown cells), `displayMode`
(`'auto'` default = type-aware formatting, or `'raw'` = verbatim source),
`maxRows` / `height` (bounded-height scroll viewport), `renderCap`,
`eagerCells`, `worker`, `headerMode`, and `selectable` / `selectMode`
(`'row'`/`'cell'`/`'none'`) / `hiddenColumns` (clickable rows/cells — see
below). Methods: `setData(data)` (returns a
promise), `setWidthMode(mode)`, `setDisplayMode('auto'|'raw')`,
`getSelection()` / `clearSelection()` / `selectRow(i)`, `destroy()`, and the
static `CsvGrid.forElement(elOrSelector)`.
Dark mode follows the OS
(`prefers-color-scheme`) and can be forced with
`data-theme="dark"|"light"` on the grid element. Multiple grids per page
work; types and formatting are inferred from the data exactly as in the
app. As an npm dependency: `"csv-grid": "file:path/to/csv-viewer"`
resolves the `exports` map.

#### Clickable rows & cells

With `selectable: true`, a body click dispatches a bubbling, cancelable
`csvgrid:cellclick` from the grid element. `event.detail` carries the
clicked cell **and the whole row keyed by column name** (raw + formatted),
with the **original** row index — stable across sort/filter — so identity
travels in the event and nothing is reconstructed from DOM position. The
grid takes no action beyond an optional highlight (`selectMode`); the
embedder wires behavior to the event. `hiddenColumns` carries a key column
in the payload without displaying it.

```html
<script>
new CsvGrid('#grid', { csv, name: 'transactions' },
    { selectable: true, selectMode: 'row', hiddenColumns: ['trans_id'] });

document.addEventListener('csvgrid:cellclick', e => {
    const d = e.detail;                       // {name, rowIndex, column, value,
    if (d.name !== 'transactions') return;    //  valueText, row, rowText, …}
    openDetail(d.row.trans_id);               // identity from the payload
});
</script>
```

`detail` fields: `name`, `rowIndex` (original), `viewIndex`, `column`,
`columnIndex`, `value` (typed number where the grid has one, else raw
string, else null), `valueText` (as displayed), `row` / `rowText` (whole
row by column name, including `hiddenColumns`), `originalEvent`. The
fixture `dev/select-test.html` exercises it.

### Python: csv_grid

The grid is on PyPI as **[csv-grid](https://pypi.org/project/csv-grid/)**
(`pip install csv-grid`, `import csv_grid`) — a uv project under
`python/` emitting CsvGrid HTML from pandas DataFrames (see
`python/README.md`):

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

Curated test data lives in `tests/csv/curated/` and `tests/md/` (see
`tests/README.md`). Embed/worker fixtures in `dev/`: `embed-test.html`
(dist UMD, two grids), `embed-test-es.html` (dist ES module),
`worker-test.html` / `worker-test-dist.html` (worker pathing),
`embed-test-python.html` (generated by the Python emitter). See
`CHANGELOG.md` for release history and `dev/` for plans.
