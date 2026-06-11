# plan-punchup — fuzzy search + equal-risk column widths (v1.1)

Status: **designed, awaiting go-ahead.** From discussion 2026-06-11.

## 1. fzf-style fuzzy matching in the global search box

Replace plain substring with fzf semantics, scored subsequence matching, at
fzf-like speed.

### Semantics (fzf extended-search subset)

- Space-separated terms AND together.
- Each term is a fuzzy subsequence match by default: `mlch` matches
  "Middlemarch".
- `'exact` for exact substring, `!term` to negate, `^pre` / `suf$` anchors.
- Case-insensitive unless the term has an uppercase letter (smart case).

### Scoring & speed

fzf-v2-style scoring on a per-row basis over the prebuilt `searchable`
strings: bonus for consecutive matched chars and matches at word boundaries
(start, after space/`_`/`-`/digit-letter transition), gap penalties.
Implementation is a simple O(n·m) two-row DP per (term, row) with an early
charset/ordering prefilter (cheap subsequence scan first; only score rows
that pass). JS comfortably does this over 100k rows of short strings in a
few ms per keystroke; debounce at ~50 ms as insurance.

When fuzzy search is active and no column sort is selected, order rows by
descending match score (best matches first); any header click overrides.
Per-column filters keep their current semantics (substring / comparisons).

## 2. Tight columns + equal-risk width allocation

### Default: tight

Tight = each column at the minimum width that shows every formatted cell
(and its header) in full. Drop the uniform 50ch cap. Measure formatted cell
widths once at load with a canvas `measureText` (same font as the table) —
no DOM thrash; gives the per-column width distribution `F_j`.

### When natural width exceeds the viewport: equal-risk VaR allocation

Table layout with truncation is a hard combinatorial problem; don't solve
it — allocate it, like capital:

- Column j's cell widths are a sample from `F_j`; showing a cell fully
  "costs" its width; truncation is the loss event.
- Find the single percentile `q` such that `Σ_j max(VaR_q(F_j), floor_j) =
  available width`, where `floor_j` covers the header (or a sane minimum).
  `q ↦ Σ_j VaR_q(F_j)` is monotone — solve by bisection over the sorted
  width arrays (O(cols · log) per evaluation, instant).
- Effect: low-sd columns hit their max early and display fully; high-sd
  columns absorb the squeeze — exactly "equal risk": every column truncates
  with the same probability `1 − q`.
- Truncated cells keep the ellipsis + tooltip treatment. Re-solve on window
  resize (debounced) and after filtering? — v1.1 keeps widths from the full
  data (stable layout); a "fit to filtered" toggle is a later idea.
- Implementation: set explicit `width` on `<col>` elements +
  `table-layout: fixed` (replaces `width: auto`), which also speeds up
  rendering of wide tables.

Connection to capital allocation / the paper idea is logged in `../TODO.md`.

## Steps

1. Canvas width measurement at load; per-column sorted width arrays.
2. Width solver (tight if it fits, else bisect for q); `<col>`/fixed layout.
3. Fuzzy matcher: prefilter + scoring DP; term parser (AND, `'`, `!`, `^`,
   `$`, smart case).
4. Score-ordered view when fuzzy active and unsorted.
5. Extend `dev/smoke-test.mjs`: matcher cases, solver cases (synthetic
   width distributions, degenerate: one huge column, all-equal widths).
6. Bump `VERSION` to 1.1.0; `CHANGELOG.md`; `human-hints.md`.

*Stays in `dev/` until the author says it is done.*
