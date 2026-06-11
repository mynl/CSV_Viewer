# plan-2.0-speedups — sampled widths, deferred search, lazy formatting

From discussion 2026-06-11, after Steve hit the wall on a 250K-row
synthetic df. Big internal change → **2.0.0**. Worker + Vite explicitly
pended. Bundling is not a speed tool (see human-hints 250K entry).

**Executed — benchmark findings (250K × 6 synthetic, Node):** the "wall"
was most likely a hard CRASH: `classifyNumber` used `Math.max(...nz)`,
which blows the call stack spreading 250K arguments (now a loop). Two
further wins found while benchmarking: `toLocaleString` builds an
`Intl.NumberFormat` per call (~0.1ms/cell) — now one cached formatter per
decimal count (full-table format 52s → 1.5s); and date inference parsed
each cell twice for day-first candidacy when matchability is
convention-independent — now parses once, re-parsing a column only when a
day-first signal appears (infer 4.9s → 2.0s). Load-critical formatting is
now 68ms (lazy, ~4K rows). Remaining main-thread cost ≈ parse 0.4s +
infer 2.0s — that residue is the future worker's job.

## Where the load time actually goes (250K rows × 10 cols)

| Stage | Cost | Fix here? |
|---|---|---|
| RFC 4180 parse | O(chars), moderate | no (worker later if needed) |
| type inference | O(cells), pure JS | no — correctness needs every cell (strict all-or-nothing typing) |
| formatted cache | 2.5M `toLocaleString` calls | **lazy** |
| search strings | 500K concat + lowercase | **deferred + chunked** |
| `measureText` per cell | millions of canvas calls — the killer | **sampled** |

## 1. Sampled width measurement (the actuarial one)

Width percentiles for the equal-risk allocator come from a deterministic
stride sample of ~2,000 rows per column instead of every row (estimating a
quantile curve from a sample — exactly a VaR estimation problem). Caveat
accepted: the "natural" width is the sample max, so a single freak-wide
outlier cell may ellipsize even unsqueezed (tooltip + drag + dblclick-fit
cover it).

## 2. Lazy formatting

`state.formatted` becomes a per-row cache filled on demand by
`getFormattedRow(r)`. Rendering touches ≤ RENDER_CAP rows; the width
sample touches ~2,000; so a 250K-row load formats a few thousand rows, not
250K. **Below `EAGER_CELLS` (200,000 cells ≈ 20K rows × 10 cols) the whole
cache is prefilled at load — small files behave byte-identically to
v1.5.x.** No chunking needed for display: on-demand is strictly better.

## 3. Deferred, chunked search index

The global search needs formatted+raw text for every row, so for large
files the index builds on the FIRST search keystroke, in chunks of
~10,000 rows yielded via `setTimeout(0)` (UI stays alive; status bar shows
"indexing search …%"). Until ready, the global term is simply not applied
(rows stay unfiltered); when the build completes the pending query applies
automatically. Column filters and sorting never need the index and work
immediately at any size. A load-generation token abandons a stale build if
a new file arrives mid-index. Side effect: a completed index also fills
the formatted cache (it formats every row on the way through).

## Non-changes

- Type inference stays a full pass (sampling it could misformat a column
  on an unseen text value — correctness over speed here, and it is pure
  JS, not the bottleneck).
- "Show all" on a 250K-row filter result still formats + renders
  everything synchronously — inherent to showing 250K DOM rows; noted,
  not fixed (virtual scrolling is the someday-fix, pended with worker).

## Steps

1. Constants `EAGER_CELLS`, `WIDTH_SAMPLE`, `INDEX_CHUNK`; `sampleIndices`
   (pure, tested); `getFormattedRow`; `buildSearchIndexChunked` with
   `loadGen` abandonment.
2. `loadText`: eager/lazy decision; `measureLayout`: sampled rows via
   `getFormattedRow`; `rebuildView`: gate global terms on `searchReady`;
   `renderStatus`: indexing progress; `renderBody`: via `getFormattedRow`.
3. Smoke tests (sampling); bump 2.0.0 (`app.js` + `sw.js`); CHANGELOG;
   human-hints.

*Stays in `dev/` until the author says it is done.*
