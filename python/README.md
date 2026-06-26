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

- `show(df, **options)` displays via IPython. Each grid carries the JS +
  CSS via an idempotent `<head>` guard (`assets="inline"`, the default),
  so fragments are self-contained and re-running/clearing a notebook cell
  can't strip a shared stylesheet. Use `assets="https://…/base"` to link
  the assets from a URL instead, or `assets=False` if they are already on
  the page.
- `to_html(df, **options)` returns a self-contained HTML fragment;
  fragments compose freely (no need to mark a "first" one).
- `payload(df)` returns the `{records, columns}` dict the grid consumes,
  if you want to ship data yourself.
- Options mirror the JS API in snake_case: `global_search`,
  `column_filters`, `sortable`, `status_bar`, `expand_buttons`, `align`
  (`'llrcr…'`), `formats`/`fmt` (per-column `[,][.N](f|d|%|e|s)`,
  `'year'`, `'eng'`, None = auto), `width_mode` (`'equal-risk'` default,
  or `'coverage'` to maximize the count of fully-shown cells),
  `display_mode` (`'auto'` formatted / `'raw'` verbatim), `rows`
  (cap the viewport to ~N rows, vertical scroll for the rest) /
  `max_height` (raw CSS, e.g. `'400px'`), `render_cap`, `eager_cells`,
  `worker` (default False — data is inlined), plus `name` (status line)
  and `index` (include the DataFrame index as leading columns). Dark mode
  follows the host page (`prefers-color-scheme`; JupyterLab dark themes
  included) unless `theme="light"`/`"dark"` forces it.
- **Clickable rows/cells** (`selectable=True`): a body click fires a
  bubbling `csvgrid:cellclick` DOM event whose `detail` carries the clicked
  cell and the whole row keyed by column name (raw + formatted) with the
  original row index — wire it to HTMX/JS for drill-down. `select_mode`
  (`'row'`/`'cell'`/`'none'`) controls the highlight; `hidden_columns=[…]`
  ships a key column in the payload without displaying it. No Python
  callback — `to_html` stays a pure string emitter.

```python
to_html(df, name="transactions", selectable=True,
        select_mode="row", hidden_columns=["trans_id"])
```

Dates are emitted ISO (`yyyy-mm-dd`, with `hh:mm` only when a column has
non-midnight times); integral float columns are emitted as integers so
the grid's integer/year rules apply.
