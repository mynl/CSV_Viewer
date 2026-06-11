# plan-viewer — CSV viewer SPA, v1.0

## Goal

A zero-build, single-page CSV viewer in vanilla JS/HTML that is actually
pleasant to use. Open `index.html` in a browser; no server, no framework, no
build step. Look and feel follows the archivum apps (Bootstrap 5 via CDN).

## Requirements (from discussion 2026-06-11)

1. **Ingest** — an "open / paste / drag" box modeled on the archivum
   `/ingest` page: dashed-border drop zone (drop file or click to browse),
   plus a paste textarea for raw CSV. Also accept Ctrl+V paste and a file
   dropped anywhere on the page.
2. **Filtering** — like the ITables/DataTables table on the
   Reading-Since-1990 blog post: a global search box filtering all columns,
   plus a per-column filter row. Numeric/date columns accept comparison
   filters (`>100`, `<=5`, `10..20`); text columns substring match
   (case-insensitive).
3. **Sorting** — click a header to sort; click again to reverse; third click
   restores original order. Type-aware compare (numeric, date, text). Blanks
   sort last. Arrow indicator in the header.
4. **Sensible number formats** — thousands separators; per-column decimal
   places = max observed in the data (capped); integers shown as integers.
5. **Date aware** — recognize ISO (`yyyy-mm-dd`), US slash (`m/d/yyyy`), and
   ISO datetimes; render uniformly as `yyyy-mm-dd` (`+ hh:mm` if any time
   component present).
6. **Alignment** — numbers and dates right-aligned, text left-aligned,
   headers follow their column.
7. **Autosizing columns** — browser auto layout sizes columns to content;
   very wide text capped (~50ch) with ellipsis and full value in a tooltip.

## Design

### Files

```
index.html      page shell: ingest card + (hidden) table view, Bootstrap CDN
styles.css      drop-zone, table, sticky header, alignment classes
app.js          all logic, no dependencies
```

### Parsing

- Hand-rolled RFC 4180 parser (quoted fields, embedded delimiters/newlines,
  doubled quotes). No Papa Parse — keep it dependency-free and debuggable.
- Delimiter sniffing over the first ~20 lines: comma, tab, semicolon, pipe —
  pick the delimiter with the most consistent per-line count > 1.
- First row = headers. (Headerless detection deferred — see Later.)

### Type inference

Per column, over non-blank values: if **all** parse as numbers → `number`
(track integer-ness and max decimals); else if all parse as dates → `date`;
else `text`. Strict all-or-nothing for v1.0; a tolerance threshold is a
possible later refinement. Number parsing strips thousands-separator commas
and accepts `(123)` negatives and `%`.

### State & rendering

- Loaded data kept as raw strings plus a parallel typed array per column.
- View = filter (global ∧ per-column) then sort, producing an index array;
  re-render `<tbody>` from that.
- Render cap ~2,000 rows with a "show all" link (filter/sort always run over
  the full data). Status bar: file name, rows shown / total, column count.
- Sticky header; "Open" button returns to the ingest screen.

### Versioning

Version string in `app.js` (`const VERSION`), shown in the footer; tracked in
`CHANGELOG.md`. This plan executes as **1.0.0**.

## Steps

1. `index.html` — ingest card (drop zone + paste box) and table view shell.
2. `app.js` — parser + delimiter sniff; type inference; formatters.
3. `app.js` — render pipeline: header, filter row, body, status bar.
4. `app.js` — sorting, global + per-column filtering with comparison syntax.
5. `styles.css` — drop zone, alignment, sticky header, column width caps.
6. Smoke-test with hand-made CSVs (quoted fields, dates, big numbers, blanks).
7. `CHANGELOG.md` 1.0.0, minimal `README.md`, update `human-hints.md`.

## Later (not v1.0)

- *(Constraint relaxed 2026-06-11)* Zero-build is a choice, not a
  requirement: migrating to a Vite/npm build (pattern: aggregate_api/web)
  and/or serving from a local server is fine once a real dependency or
  module split earns it. Local-to-machine preferred over hosted.

- Virtual scrolling for very large files; Web Worker parse.
- Column show/hide, reorder, pin.
- Copy/export filtered view (CSV / markdown / clipboard).
- Headerless-file detection; manual type override per column.
- Saved views / recent files (localStorage).

*Stays in `dev/` until the author says it is done.*
