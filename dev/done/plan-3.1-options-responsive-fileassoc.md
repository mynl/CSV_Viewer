# plan-3.1 — width upgrade, options, dark mode, responsive, file handlers

**Status: DRAFT, decisions mostly locked 2026-06-13.** One open sign-off
(`**Q:**`) remains: the width-allocation semantic shift (§1). Once that is
blessed this converts to staged work (each stage ends green, author
commits, version bump in the usual three places + python).

## Context

3.0 arc done (v3.0.7): grid in `src/grid/`, `dist/` committed, `csv-grid`
on PyPI, viewer on GitHub Pages, PWA opens `.csv`. 3.1 is polish + reach,
deliberately smaller than 3.0.

## Decisions locked
- Option names stay (`global_search`, `column_filters`, etc.) — no renames.
- `rows` / `max_height` = bounded-height + vertical scroll (NOT pagination).
- Width: BOTH methods kept and selectable via `width_mode` (default =
  current equal-risk, no regression); new coverage/water-fill added — §1.
- Responsive: both toolbars. Guiding principle (author): "must not be
  embarrassing on a phone" — good on iPad/desktop, acceptable on phone.
- Dark mode: in (auto via prefers-color-scheme + explicit override).
- File handlers: granular, text formats only.
- **Parquet/Feather: DROPPED. Do not re-add. YELL if it comes up again.**
- Export-view and column-stats: parked in §7 (good, but a distraction now).

---

## 1. Width allocation — add coverage/water-fill ALONGSIDE equal-VaR

Two selectable methods. The current equal-VaR stays and is the DEFAULT
(no regression). New option `width_mode` (JS `widthMode`):

- **`'equal-risk'` (default)** — today's rule: one global percentile q*,
  `w_j = max(floor_j, P_j(q*))`, bisect q* so Σ w_j = budget. Every column
  shows the same proportion of its cells in full (equal truncation prob).
- **`'coverage'`** — maximize total cells shown in full:
  > max Σ_j F_j(w_j)  s.t.  Σ w_j ≤ budget,  floor_j ≤ w_j ≤ natural_j
  F_j = column j's empirical width CDF. Completes cheap thin-tail columns
  to 100%; concentrates truncation on expensive thick-tail outliers (the
  right cell to truncate). Equal-VaR is the equal-tail special case; they
  diverge exactly when tails differ.

**How coverage is solved (greedy water-fill).** Per column, cells-shown
vs width is a step function (each distinct sampled width adds the cells at
that width). Greedy-by-marginal is optimal only on a CONCAVE curve and a
CDF need not be concave, so first take each column's UPPER CONCAVE
ENVELOPE — its efficient frontier of (width, cumulative cells), segments
of strictly decreasing slope (cells/px). Then:
  1. Start every column at floor_j; commit Σ floor_j.
  2. Pool all columns' envelope segments; sort by slope (cells/px) desc.
  3. Buy in that order (partial buy of the last affordable segment is fine
     — width is continuous) until budget exhausted or all at natural_j.
Equivalently a max-heap on each column's current next-segment slope: pop
steepest, advance, push next. Equalizes marginal cells/px at a cutoff
slope λ (water-filling). O(segments·log C), once per load, deterministic,
frozen per load. Fits-tight / floors-scroll regimes and Expand/drag
unchanged; only the squeeze allocation differs.

**Worked toy (why coverage wins).** Two columns, 4 sampled cells each,
7px above floors. Col A (thin) needs widths 1,2,3,4; Col B (thick) needs
1,2,3,40. equal-VaR holds both at the 75th pct (A=3,B=3, 6px) and leaves
1px idle — it won't break symmetry to finish A while B's outlier is
unreachable. coverage spends that pixel to complete A (A→4/4, B 3/4): 7
cells shown vs 6, outlier correctly truncated.

**Control surface.** `width_mode` joins the option list (align/formats/…),
same plumbing every layer:
- JS: `new CsvGrid(el, data, {widthMode: 'coverage'})`
- Python: `show(df, width_mode='coverage')` (one `_OPTION_MAP` line)
- Viewer URL: `?widths=coverage` parsed alongside `?src=`
- Both solvers consume the SAME measureLayout output → switching mode is a
  re-solve with NO re-measure (no reload needed).
- **DECIDED (2026-06-13):** default = `equal-risk` (no surprise; coverage
  opt-in). Viewer gets BOTH the `?widths=` URL param AND a labeled navbar
  control — a segmented "Fit: balanced | maximize" (two explicit labeled
  states, NOT a morphing toggle, per the no-play/pause rule). The navbar
  control is part of the responsive-toolbar work (§4): it must collapse
  gracefully on a phone (icon-only, or fold into the overflow) like the
  other buttons — do not let it break the narrow layout.

Lives in `src/grid/util.js` (`solveWidths` gains a mode, or two named
solvers + dispatch); smoke-testable in isolation — add coverage-mode
checks + a thin-vs-thick-tail fixture. Good first stage.

## 2. Compact height — `rows` / `max_height`
- Python `rows=N` → cap the scroll viewport to ~N rows; internal vertical
  scroll for the rest; sticky header stays. `max_height='400px'` raw escape
  hatch. `render_cap` stays the separate DOM/perf cap.
- JS: `maxRows` / `height` (name TBD) → `max-height` on `.csvgrid-scroll`.
- Not pagination (deliberate).

## 3. Dark mode
- Lift grid.css's ~15 hardcoded colors into CSS custom properties on
  `.csvgrid` (light defaults); one `@media (prefers-color-scheme: dark)`
  block overrides them → auto-follows OS. **This fixes the JLab "white
  island" header bug** (sticky header bg is hardcoded `#fff`).
- Explicit override hook `.csvgrid[data-theme="dark"|"light"]` for hosts
  theming independently of the OS.
- Viewer: Bootstrap 5.3 `data-bs-theme`, set from prefers-color-scheme.
- Decision: auto baseline; add a viewer toggle only if wanted. Difficulty
  low-medium (mechanical color extraction + one override block); risk is
  cosmetic, caught by screenshots.

## 4. Responsive toolbars
- **Viewer navbar** (Bootstrap, app): viewport media queries — collapse
  button labels to icons, push "Row 1 = header" into an overflow on narrow
  screens, keep one row. Principle: not embarrassing on a phone.
- **Grid's own `.csvgrid-toolbar`** (embeds): respond to GRID width not
  viewport → CSS container queries (`container-type: inline-size` on
  `.csvgrid`). Grid is dependency-free → icon-only mode via inline SVG or
  unicode glyphs (no Bootstrap Icons).
- Includes the §1 width-mode segmented control ("Fit: balanced |
  maximize") in the viewer navbar — must collapse with the rest on narrow
  screens (icon-only or overflow), not break the one-row layout.
- Verify against the v3.0.7 look on a real narrow device.

## 5. Granular file handlers (text formats)
- `file_handlers` array: one entry PER extension (csv, tsv, tab, txt);
  register ONLY wanted candidates (no `.md` — that was the over-bundling).
- Per-extension default selection lives in Windows Settings regardless.
- **Q to verify in impl:** Chromium install-prompt granularity.

## 6. Docs (stage 6, like 3.0)
- Beef up the `show()` docstring into a single enumerated options
  reference; mirror in `python/README.md` (one options table).
- README / CLAUDE.md / CHANGELOG / human-hints as usual.

## 7. Parked considerations (NOT 3.1 — revisit later)
- Export filtered/sorted view as CSV (high fit, low cost).
- Column summary stats — sum/mean/min/max (quant fit, medium cost).
- (Earlier menu also had: copy-to-clipboard, frozen first column, URL
  state. Frozen-first-column pairs naturally with wide-CSV work if §1
  whets the appetite.)

## Proposed staging (after §1 sign-off)
1. Width allocation upgrade (`util.js`) + solver tests. *Self-contained,
   highest-value, mathematical — first.*
2. `rows` / `max_height` (grid + python).
3. Dark mode (grid.css variables + viewer Bootstrap + JLab island fix).
4. Responsive toolbars (viewer media queries + grid container queries).
5. Granular file handlers (manifest).
6. Docs.

## Risks / discipline
- Keep 3.1 smaller than 3.0.
- Bundle-size watch: grid ~23 KB; SVG icons / variables / solver are fine.
- Standing rules: every `src/grid/` change → `npm run build` + commit
  `dist/`; version in three places (+ python when it changes); bump sw.js
  cache for shell changes.
- Container queries + prefers-color-scheme: fine in 2026 browsers; verify
  on a real phone.

*Stays in `dev/` until the author says it is done.*
