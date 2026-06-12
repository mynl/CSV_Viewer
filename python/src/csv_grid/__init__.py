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

__version__ = "3.0.7"
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
    "render_cap": "renderCap",
    "eager_cells": "eagerCells",
    "worker": "worker",
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


def _assets_fragment(assets) -> str:
    """'inline' -> embed css+js; a string -> <link>/<script src> against
    that base URL; False/None -> '' (already on the page). The iife build
    is used (not umd): pages rendered by Quarto/Jupyter can carry
    RequireJS, which hijacks a umd wrapper via define.amd and the global
    CsvGrid never appears."""
    if assets == "inline":
        return (f"<style>\n{_asset_text('csv-grid.css')}\n</style>\n"
                f"<script>\n{_asset_text('csv-grid.iife.js')}\n</script>")
    if assets:
        base = str(assets).rstrip("/")
        return (f'<link rel="stylesheet" href="{base}/csv-grid.css">\n'
                f'<script src="{base}/csv-grid.iife.js"></script>')
    return ""


def _dump(obj) -> str:
    # `<\/` keeps a literal '</script>' in the data from closing our tag
    return json.dumps(obj, ensure_ascii=False, default=_jsonable).replace("</", "<\\/")


def to_html(df, *, name: str | None = None, assets="inline",
            index: bool = False, **options) -> str:
    """HTML fragment rendering `df` as a CsvGrid. The first fragment on a
    page should carry the assets (default 'inline'; or a base URL hosting
    csv-grid.umd.js + csv-grid.css); pass assets=False for later tables.
    Options are the grid's, in snake_case (see _OPTION_MAP); `fmt` is an
    alias for `formats`; `worker` defaults to False (data is inlined).
    """
    opts = _map_options(options)
    opts.setdefault("worker", False)
    div = f"csvgrid-{uuid.uuid4().hex[:12]}"
    parts = []
    head = _assets_fragment(assets)
    if head:
        parts.append(head)
    parts.append(
        f'<div id="{div}"></div>\n'
        f'<script>new CsvGrid(document.getElementById("{div}"), '
        f'{_dump(payload(df, name, index))}, {_dump(opts)});</script>'
    )
    return "\n".join(parts)


_assets_emitted = False


def show(df, *, name: str | None = None, assets=None,
         index: bool = False, **options) -> None:
    """Display `df` as a CsvGrid in Jupyter / Quarto. Assets are emitted
    once per kernel session (= once per rendered page); assets='inline'
    forces re-emission (e.g. after restarting the browser page without
    the kernel), a base-URL string loads them from there instead.
    """
    global _assets_emitted
    try:
        from IPython.display import HTML, display
    except ImportError as e:  # pragma: no cover
        raise ImportError("csv_grid.show() needs IPython; "
                          "use to_html() outside Jupyter/Quarto") from e
    if assets is None:
        assets = False if _assets_emitted else "inline"
    _assets_emitted = True
    display(HTML(to_html(df, name=name, assets=assets, index=index, **options)))
