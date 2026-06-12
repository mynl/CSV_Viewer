# csv_grid

Python emitter for **CsvGrid**, the embeddable interactive table of the
[csv-viewer](https://github.com/mynl/CSV_Viewer) project: render a pandas
DataFrame as a sortable, filterable, type-aware grid in Jupyter, Quarto
(`.qmd`), or any static HTML you generate.

The grid re-infers column types from the data exactly as the viewer app
does (numbers right with greater_tables-style formatting, dates ISO and
centered, fzf search, equal-risk column widths). NaN / None become blank
cells.

## Install

```
uv add csv-grid              # or: pip install csv-grid
```

or local path install from a clone of this repo:

```
uv add --editable path/to/csv-viewer/python
```

The grid's built JS/CSS assets ship inside the package (refreshed by the
repo's `npm run build`).

## Use

```python
from csv_grid import show, to_html

show(df)                          # Jupyter / qmd cell: display the grid
show(df, align="llrcr", fmt=[None, None, ",d", "year", ",.2f"])

html = to_html(df, name="results.df", assets="inline")   # fragment string
```

- `show(df, **options)` displays via IPython. The JS + CSS assets are
  emitted once per kernel session (so once per rendered page); pass
  `assets="inline"` to force re-emission, or `assets="https://…/base"`
  to load them from a URL instead of inlining.
- `to_html(df, **options)` returns an HTML fragment. The first fragment
  on a page should carry the assets (`assets="inline"` — the default —
  or a base URL); pass `assets=False` for subsequent tables.
- `payload(df)` returns the `{records, columns}` dict the grid consumes,
  if you want to ship data yourself.
- Options mirror the JS API in snake_case: `global_search`,
  `column_filters`, `sortable`, `status_bar`, `expand_buttons`, `align`
  (`'llrcr…'`), `formats`/`fmt` (per-column `[,][.N](f|d|%|e|s)`,
  `'year'`, `'eng'`, None = auto), `render_cap`, `eager_cells`,
  `worker` (default False — data is inlined), plus `name` (status line)
  and `index` (include the DataFrame index as leading columns).

Dates are emitted ISO (`yyyy-mm-dd`, with `hh:mm` only when a column has
non-midnight times); integral float columns are emitted as integers so
the grid's integer/year rules apply.
