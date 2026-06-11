# csv-viewer

A no-nonsense CSV viewer: a zero-build, single-page web app in vanilla
JS/HTML. Drag a file in (or paste data), get a sortable, filterable,
properly formatted table. Everything runs in the browser; nothing is
uploaded anywhere.

## Use

Open `index.html` in any modern browser. Drop a CSV/TSV file, click to
browse, or paste data (Ctrl+V works directly on the open screen).

- Click a header to sort (again to reverse, third click to reset).
- Global search box filters across all columns; the per-column filter row
  matches substrings, and on numeric/date columns accepts `>100`, `<=5`,
  `=3`, and `10..20` ranges.
- Numbers get thousands separators and consistent decimals; dates are
  normalized to `yyyy-mm-dd`; numbers/dates align right, text left.

## Development

No build step, no dependencies. Logic smoke test:

```
node dev/smoke-test.mjs
```

See `CHANGELOG.md` for release history and `dev/` for plans and the
roadmap.
