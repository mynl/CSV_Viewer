# Changelog

## 1.0.0 (2026-06-11)

Initial release, executed from `dev/plan-viewer.md`.

- Zero-build vanilla JS/HTML SPA: open `index.html`, no server or framework.
- Ingest screen modeled on the archivum `/ingest` page: drag-and-drop zone
  (or click to browse), paste textarea, and direct Ctrl+V paste. Files can
  also be dropped anywhere on the page.
- RFC 4180 parser with automatic delimiter sniffing (comma, tab, semicolon,
  pipe); handles quoted fields, doubled quotes, embedded newlines, ragged
  rows.
- Per-column type inference: number (thousands commas, `(123)` negatives,
  `$`, `%`), date (ISO and US slash forms, optional time), text.
- Sensible formatting: thousands separators, per-column fixed decimals
  (max observed, capped at 6), dates normalized to `yyyy-mm-dd`.
- Numbers and dates right-aligned, text left-aligned; columns autosize with
  a 50ch cap (ellipsis + tooltip for long values).
- Click-to-sort headers (asc / desc / reset), type-aware, blanks last.
- Global search box plus per-column filter row; numeric/date columns accept
  `>x`, `>=x`, `<x`, `<=x`, `=x`, and `a..b` ranges.
- Render cap of 2,000 rows with "show all" (filter/sort always cover the
  full data); status bar with file name and shown/total row counts.
- Logic smoke test: `node dev/smoke-test.mjs` (35 checks).
