# csv-viewer

A no-nonsense CSV viewer: a zero-build, single-page web app in vanilla
JS/HTML. Drag a file in (or paste data), get a sortable, filterable,
properly formatted table. Everything runs in the browser; nothing is
uploaded anywhere.

## Use

Open `index.html` in any modern browser. Drop a CSV/TSV file, click to
browse, or paste data (Ctrl+V works directly on the open screen). Served
over localhost or https it is an installable PWA (offline-capable), and
`?src=<url>` auto-loads a CSV — handy for iframe embeds.

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
  names (`Date`, `Description 1`, `Amount`, …). The Expand button gives
  every column its full natural width with horizontal scroll.
- Columns are sized tight (minimum width showing everything) when the table
  fits the window; when it doesn't, width is allocated so every column
  truncates with equal probability — widths are frozen per file load.

## Development

No build step, no dependencies. Logic smoke test:

```
node dev/smoke-test.mjs
```

See `CHANGELOG.md` for release history and `dev/` for plans and the
roadmap.
