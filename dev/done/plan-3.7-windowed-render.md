# plan 3.7 — windowed (virtualized) body rendering

> Status: **proposed, awaiting go-ahead.** Supersedes the reverted 3.6
> debounce (`dev/done/plan-3.6-search-debounce.md`). This is the real fix for
> large-file sluggishness.

## Problem

Filtering/sorting a large file is sluggish — a 35k-row frame can go
unresponsive ("translucent"). Measured per-keystroke *logic* is cheap (fuzzy
score all 35k rows 9–47 ms; column predicate 4–6 ms). The cost is the **DOM
render**: `renderBody` rebuilds a `min(view, renderCap=2048)`-row × N-col
`<tbody>` via `innerHTML` on every refresh — the browser parses ~30–60k cells
and re-lays-out a `table-layout:fixed` table. On wide / long-text rows that is
300 ms – 1 s **per refresh**, and a refresh fires on every keystroke.

The 3.6 debounce tried to fire fewer refreshes; it failed because it can't make
a render *cheap*, only later. The fix is to make each render **O(viewport)
instead of O(renderCap)** — render only the rows actually on screen.

## Framing

Rows are `white-space: nowrap` + ellipsis → **uniform single-line height**.
With a known row height `h` and viewport height `H`, only `⌈H/h⌉ + buffer` rows
are ever visible (~30–60). Rendering that fixed window makes refresh cost
independent of `view.length`: 2048-row (or 35k-row "show all") renders collapse
to ~50-row renders. Scroll position maps to a row offset; we re-render the
window as it changes.

## Design

**Geometry.** After the first body render, measure `h` = one data row's
`offsetHeight` (already done for `_applyHeight`, line ~388). Total scrollable
height = `view.length * h`. The visible window is
`start = max(0, floor(scrollTop / h) - BUFFER)`,
`end = min(view.length, start + visibleCount + 2*BUFFER)`.

**Spacer technique (table-friendly).** Keep one `<table>`; render only rows
`[start, end)` into `<tbody>`, framed by two zero-content spacer rows that
reserve the off-screen height so the scrollbar and sticky header behave:
- top spacer: a single `<tr><td colspan=visibleCols style="height:start*h px; padding:0; border:0"></td></tr>`
- bottom spacer: height `(view.length - end) * h`.
(Spacer rows beat `transform: translateY` here — they keep native scrollbar
sizing and don't fight `table-layout: fixed`.)

**Scroll handler.** One listener on `this.els.scroll` (per-instance — complies
with no-document-listeners). On scroll, recompute `start/end`; only re-render
when the window actually moves by ≥ 1 row (cheap guard). rAF-coalesce so a
fling fires at most one render per frame.

**renderBody changes.** Split into:
- `renderBody()` — recompute geometry + window, set spacer heights, render the
  slice. Called by `refresh()` and on resize.
- `_renderWindow()` — the scroll-driven slice re-render (no geometry rebuild
  unless `view.length` changed).

**What this removes / simplifies.**
- `renderCap` / `showAll` / `capNote` / `showAllBtn` become **obsolete** — every
  row is reachable by scrolling, no "show first 2048" note. Decision needed:
  drop them, or keep `renderCap` as a hard *DOM* window size only. **Proposed:
  drop the cap-note UI; keep the option name as a no-op for embedder API
  stability, documented as deprecated.** (Confirm — this is the one
  behavior-visible change.)
- `_applyHeight` (maxRows/height) stays; it bounds `H`, which now also bounds
  the render window — synergy, not conflict.

**Touch points that assume "the row is in the DOM".**
- `_paintSelection` / `selectRow`: a selected row outside the window has no
  `<tr>`. `selectRow` must scroll by computed offset (`start*h`) first, then
  render, then paint. `_paintSelection` already no-ops when the `<tr>` is
  absent — fine; it re-paints when the row scrolls in.
- Tooltip `mouseover`, body click delegation: unaffected (operate on rendered
  rows only).
- Drag-resize / colgroup / `applyLayout`: unaffected (column geometry is
  independent of which rows are rendered).
- `measureLayout`: unaffected (samples data, not DOM).

**Export, search index, sort, filters:** all operate on data/`view`, never the
DOM — untouched.

## Files touched

- `src/grid/grid.js` — `renderBody` rewrite + `_renderWindow`, scroll listener
  wiring in `_buildScaffold`, row-height measure, spacer rows, `selectRow`
  offset-scroll, retire cap-note path. Constructor: `_rowH`, `_winStart`,
  `_winEnd`, `_scrollRaf` fields.
- `src/grid/grid.css` — spacer-row reset (height/padding/border 0); confirm no
  `:hover`/`:nth-child` rule breaks with sparse rows.
- `src/app/app.js` — likely none (cap-note lived in the grid); bump `VERSION`.
- `sw.js`, `package.json` — version → 3.7.0.
- `npm run build` — dist + python assets (grid source changed).
- `CHANGELOG.md`, `human-hints.md`.

## Verification

- 35k-row frame: filter/sort/scroll all smooth; refresh renders ~50 rows.
- Scroll to the very bottom; last row fully visible, no gap/overlap; sticky
  header + fixed footer intact.
- Column drag-resize, Expand/Contract (h-scroll) still correct mid-scroll.
- Selection survives sort/filter/scroll; `selectRow` on a far row scrolls + paints.
- Small files (≤ a few hundred rows) render identically to today (window ≥ all).
- Multi-instance: geometry/listener per-instance.
- Smoke test untouched (no logic change); perf verified manually in-browser.

## Risks / open questions

1. **Cap-note removal** — the one user-visible change. Confirm dropping
   "show all" is fine (it becomes meaningless when all rows scroll).
2. **Row-height assumption** — relies on uniform height. True today (nowrap +
   ellipsis). If a future wrap mode lands, virtualization needs variable-height
   handling; out of scope here.
3. **Horizontal + vertical** — expand mode adds h-scroll; the same scroll
   container drives both. Vertical window math uses `scrollTop` only; h-scroll
   independent. Verify the spacer `colspan` spans all visible cols so h-extent
   is preserved when the window is sparse.
