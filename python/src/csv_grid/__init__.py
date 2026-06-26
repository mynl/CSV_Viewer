"""csv_grid — emit CsvGrid (csv-viewer's embeddable grid) from pandas DataFrames.

Public API:
    show(df, **options)     display in Jupyter / Quarto via IPython
    to_html(df, **options)  return an HTML fragment for static generation
    payload(df)             the {records, columns} dict the grid consumes

The grid re-infers column types from the emitted strings/numbers exactly
as the csv-viewer app does; this module only handles serialization
(dates -> ISO strings, NaN/None -> blank, integral floats -> ints) and
option plumbing. The built JS/CSS assets live in csv_grid/assets/,
refreshed by the repo's `npm run build`.
"""

from __future__ import annotations

import json
import uuid
from importlib import resources

__version__ = "3.5.0"
__all__ = ["show", "to_html", "payload"]

# python snake_case -> CsvGrid option names (see src/grid/grid.js)
_OPTION_MAP = {
    "global_search": "globalSearch",
    "column_filters": "columnFilters",
    "sortable": "sortable",
    "status_bar": "statusBar",
    "expand_buttons": "expandButtons",
    "align": "align",
    "formats": "formats",
    "width_mode": "widthMode",
    "display_mode": "displayMode",
    "rows": "maxRows",
    "max_height": "height",
    "render_cap": "renderCap",
    "eager_cells": "eagerCells",
    "worker": "worker",
    "selectable": "selectable",
    "select_mode": "selectMode",
    "hidden_columns": "hiddenColumns",
}
_CAMEL = set(_OPTION_MAP.values())


def _map_options(options: dict) -> dict:
    """snake_case -> camelCase; `fmt` aliases `formats`; unknown keys raise."""
    if "fmt" in options:
        options["formats"] = options.pop("fmt")
    out = {}
    for k, v in options.items():
        if k in _OPTION_MAP:
            out[_OPTION_MAP[k]] = v
        elif k in _CAMEL:
            out[k] = v
        else:
            raise TypeError(f"csv_grid: unknown option {k!r} "
                            f"(known: {', '.join(sorted(_OPTION_MAP))})")
    return out


def _jsonable(o):
    """json.dumps default: numpy scalars, Timestamps, anything else -> str."""
    item = getattr(o, "item", None)          # numpy scalar -> python native
    if callable(item):
        try:
            return item()
        except (ValueError, TypeError):
            pass
    iso = getattr(o, "isoformat", None)      # stray datetime/date
    if callable(iso):
        return iso()
    return str(o)


def payload(df, name: str | None = None, index: bool = False) -> dict:
    """The {records, columns[, name]} dict CsvGrid consumes (records as
    arrays in column order). Dates become ISO strings (hh:mm only when a
    column has non-midnight times); NaN/None/NaT become None (blank cells
    in the grid); integral float columns become ints so the grid's
    integer/year formatting rules apply. Types are re-inferred grid-side.
    """
    import pandas as pd  # deferred so importing csv_grid stays cheap

    if index:
        df = df.reset_index()
    # build plain-python column lists directly: assigning converted columns
    # back into a DataFrame lets pandas re-coerce ints + None to float64
    cols = []
    for c in df.columns:
        s = df[c]
        if isinstance(s.dtype, pd.DatetimeTZDtype) or str(s.dtype).startswith("datetime64"):
            midnight = (s.dt.hour.fillna(0).eq(0) & s.dt.minute.fillna(0).eq(0)
                        & s.dt.second.fillna(0).eq(0)).all()
            fmt = "%Y-%m-%d" if midnight else "%Y-%m-%d %H:%M"
            vals = [None if pd.isna(v) else v.strftime(fmt) for v in s]
        elif str(s.dtype).startswith("float"):
            nonnull = s.dropna()
            integral = len(nonnull) > 0 and nonnull.mod(1).eq(0).all()
            vals = [None if pd.isna(v)
                    else (int(v) if integral else float(v)) for v in s]
        else:
            vals = [None if pd.isna(v) else v for v in s.tolist()]
        cols.append(vals)
    d = {
        "records": [list(row) for row in zip(*cols)],
        "columns": [str(c) for c in df.columns],
    }
    if name:
        d["name"] = name
    return d


def _asset_text(fname: str) -> str:
    return resources.files("csv_grid").joinpath("assets", fname).read_text(encoding="utf-8")


def _js_str(text: str) -> str:
    """A JS string literal (double-quoted, JSON-escaped) safe inside a
    <script>: the `</` -> `<\\/` guard stops an embedded '</script>' in the
    payload from closing our tag."""
    return json.dumps(text, ensure_ascii=False).replace("</", "<\\/")


def _assets_html(assets) -> str:
    """The CSS + JS the grid needs, emitted with EVERY grid (no per-kernel
    state — that was the notebook bug: assets parked in one cell's output
    vanish when that cell is cleared/re-run, and every grid shares them).

    'inline' (default): a guard that idempotently injects the CSS and the
    iife into the document <head>. <head> lives outside cell output, so
    clearing/re-running a cell can't strip the assets, and any grid
    re-establishes them if missing. The injected <script> sets its code via
    textContent, so it runs synchronously on insertion — window.CsvGrid is
    defined before the grid-construction script that follows.

    A base-URL string: plain <link>/<script src> tags (parser-ordered, so
    they run before construction; the browser caches them, so re-emitting
    per grid is cheap). False/None: nothing (assets already on the page).

    The iife build is used (not umd): Quarto/Jupyter pages can carry
    RequireJS, whose define.amd hijacks a umd wrapper so window.CsvGrid
    never appears."""
    if not assets:
        return ""
    if assets == "inline":
        css = _js_str(_asset_text("csv-grid.css"))
        js = _js_str(_asset_text("csv-grid.iife.js"))
        body = (
            "if(!document.getElementById('csvgrid-css')){"
            "var s=document.createElement('style');s.id='csvgrid-css';"
            f"s.textContent={css};document.head.appendChild(s);}}"
            "if(!window.CsvGrid){"
            "var j=document.createElement('script');j.id='csvgrid-js';"
            f"j.textContent={js};document.head.appendChild(j);}}"
        )
        return f"<script>(function(){{{body}}})();</script>"
    base = str(assets).rstrip("/")
    return (f'<link rel="stylesheet" href="{base}/csv-grid.css">\n'
            f'<script src="{base}/csv-grid.iife.js"></script>')


def _dump(obj) -> str:
    # `<\/` keeps a literal '</script>' in the data from closing our tag
    return json.dumps(obj, ensure_ascii=False, default=_jsonable).replace("</", "<\\/")


def to_html(df, *, name: str | None = None, assets="inline",
            index: bool = False, theme: str = "auto", **options) -> str:
    """HTML fragment rendering `df` as a CsvGrid, self-contained by default.

    Every fragment carries the assets via an idempotent guard (see
    ``assets``), so fragments compose freely — no need to mark a "first"
    one. Options are the grid's, in snake_case (see ``show``); `fmt` is an
    alias for `formats`; `worker` defaults to False (data is inlined).
    `assets='inline'` embeds the CSS + JS (injected once into <head>); a
    base-URL string links them; False omits them. `theme` forces the color
    scheme via ``data-theme`` ('auto' follows prefers-color-scheme).
    """
    opts = _map_options(options)
    opts.setdefault("worker", False)
    div = f"csvgrid-{uuid.uuid4().hex[:12]}"
    theme_attr = f' data-theme="{theme}"' if theme in ("light", "dark") else ""
    parts = []
    head = _assets_html(assets)
    if head:
        parts.append(head)
    parts.append(
        f'<div id="{div}"{theme_attr}></div>\n'
        f'<script>new CsvGrid(document.getElementById("{div}"), '
        f'{_dump(payload(df, name, index))}, {_dump(opts)});</script>'
    )
    return "\n".join(parts)


def show(df, *, name: str | None = None, assets="inline",
         index: bool = False, theme: str = "auto", **options) -> None:
    """Display `df` as a CsvGrid in Jupyter / Quarto.

    Parameters
    ----------
    df : pandas.DataFrame
        Data to render. Types and number/date formatting are re-inferred
        grid-side from the emitted values (dates -> ISO, NaN/None -> blank,
        integral float columns -> ints) exactly as the csv-viewer app does.
    name : str, optional
        Label shown in the grid's status line.
    assets : {'inline', str, False}, default 'inline'
        'inline' embeds the grid's CSS + JS, injected into the document
        <head> by an idempotent guard emitted with every grid — clearing or
        re-running a cell can't strip them, and any grid re-establishes them
        if missing. A base-URL string links the assets from there instead.
        False emits nothing (use only when the assets are already present).
    index : bool, default False
        Include the DataFrame index as leading column(s).
    theme : {'auto', 'light', 'dark'}, default 'auto'
        'auto' follows the host page / OS via prefers-color-scheme; 'light'
        or 'dark' forces the grid's color scheme (sets ``data-theme``).

    Other options (keyword, snake_case; mirror the JS CsvGrid API)
    --------------------------------------------------------------
    global_search : bool, default True   fzf search box.
    column_filters : bool, default True  per-column filter row.
    sortable : bool, default True        click headers to sort.
    status_bar : bool, default True      row-counts line.
    expand_buttons : bool, default True  Expand / Contract pair.
    align : str, optional                'llrcr…', one of l/r/c per column,
                                         overriding the type-based default.
    formats / fmt : list, optional       per-column format spec, None entry
                                         = auto rules; subset of d3/Python
                                         ``[,][.N](f|d|%|e|s)`` plus the
                                         named 'year' and 'eng'.
    width_mode : {'equal-risk', 'coverage'}, default 'equal-risk'
                                         squeeze allocation when the table
                                         is wider than its container:
                                         equal-risk = every column truncates
                                         with equal probability; coverage =
                                         maximize the count of cells shown
                                         in full.
    display_mode : {'auto', 'raw'}, default 'auto'
                                         'auto' = type-aware formatting;
                                         'raw' = verbatim source text (a view
                                         lens; types still drive alignment
                                         and sort).
    rows : int, optional                 cap the scroll viewport to ~N rows
                                         (vertical scroll for the rest).
    max_height : str, optional           raw CSS max-height (e.g. '400px');
                                         overrides ``rows`` when set.
    render_cap : int, default 2048       rows rendered before "show all".
    eager_cells : int, default 262144    below this, format everything up
                                         front (else lazy).
    worker : bool, default False         parse worker (off by default here
                                         — the data is inlined, not fetched).
    selectable : bool, default False     emit a bubbling, cancelable
                                         ``csvgrid:cellclick`` DOM event on a
                                         body click (off = no event, no cost).
                                         ``event.detail`` carries the clicked
                                         cell and the whole row keyed by column
                                         name (raw + formatted) with the
                                         original row index, so an embedder
                                         (HTMX, JS) can drill down. The grid
                                         takes no action beyond an optional
                                         highlight; no Python callback.
    select_mode : {'row', 'cell', 'none'}, default 'row'
                                         the visual highlight on click ('none'
                                         still emits the event).
    hidden_columns : list[str], optional header names carried in the event
                                         payload (and export) but not shown as
                                         columns — e.g. ship a key column
                                         without displaying it.

    Dark mode follows the host page automatically unless ``theme`` forces
    it (prefers-color-scheme; JupyterLab dark themes included).
    """
    try:
        from IPython.display import HTML, display
    except ImportError as e:  # pragma: no cover
        raise ImportError("csv_grid.show() needs IPython; "
                          "use to_html() outside Jupyter/Quarto") from e
    display(HTML(to_html(df, name=name, assets=assets, index=index,
                         theme=theme, **options)))
