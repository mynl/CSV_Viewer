# plan-1.5-markdown-tables — open and render markdown pipe tables

From discussion 2026-06-11. v1.4.3 committed; executes as **1.5.0**.
Effort check (standing YELL rule): small — ~50 lines, no speed impact.

## Behavior

- **Detection** (before the CSV path): first non-blank line contains `|`
  and the second is a separator row (`|---|:--:|` style — every cell
  matches `:?-+:?`). CSVs are untouched; a pipe-delimited CSV would need a
  literal dashes-only second line to misfire.
- **Parsing**: strip outer pipes (optional per GFM), split on `|` honoring
  escaped `\|`, trim cells. Header row, separator row (skipped), data rows
  normalized to header length.
- **Alignment follows the separator spec**: `:--` left, `:-:` center,
  `--:` right; bare `---` keeps the viewer's type-based alignment. The
  override applies to header and body cells.
- Everything downstream is unchanged: type inference, number/date
  formatting, fuzzy search, filters, width allocation. The "Row 1 =
  header" toggle still works (forcing headerless treats the md header row
  as data with guessed names).
- File picker accepts `.md`/`.markdown`; paste and drag work as for CSV.

## Steps

1. `isMarkdownTable`, `splitMdRow`, `parseMarkdownTable` (pure, tested).
2. `loadText` branch; `col.align` override; `cellClass` helper + CSS
   `align-*` classes.
3. Smoke tests; bump 1.5.0 (`app.js` + `sw.js`); CHANGELOG; human-hints.

*Stays in `dev/` until the author says it is done.*
