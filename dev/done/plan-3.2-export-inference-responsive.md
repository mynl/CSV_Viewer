# plan-3.2 — export, inference quality, responsive toolbar

Version target: **3.2.0** (additive/polish — nothing breaking, so not 4.0).
Three stages in one plan; A is independent, B→C are coupled (C organizes
B's new buttons). Author handles all commits; bump version only when code
lands (CLAUDE.md). Decisions below are settled unless marked OPEN.

## Context snapshot (survives a /clear)

- Inference lives in `src/grid/core.js` (`inferColumns`, `parseNumber`,
  `parseDate`, `classifyNumber`, the `*_TITLE_RE` regexes). It is strict
  all-or-nothing today: one unparseable, non-blank cell demotes the whole
  column. Blanks (trimmed to `''`) are already skipped.
- Display lives in `src/grid/util.js` (`formatCell`, `solveWidths`,
  `sampleIndices`). **`formatCell` already returns the raw string when a
  numeric/date column's parsed value is `null`** (util.js ~82/90) — so a
  stray non-numeric cell in a numeric column renders verbatim with no new
  code. Lazy: only rendered rows are formatted; the `Intl` formatter is
  cached per decimal count. Tunables: `WIDTH_SAMPLE = 2000`, default
  `renderCap: 2000`, `eagerCells: 200000` (→ 2048 / 2048 / 262144 here).
- `CsvGrid` (`src/grid/grid.js`) holds `view` (filtered+sorted row
  indices), `rows` (raw cells), `cols` (inference), `formatted` (lazy
  cache). `WIDTH_SAMPLE = 2000`, default `renderCap: 2000`, `eagerCells:
  200000`. Public surface: `setData / setGlobalFilter / clearFilters /
  expand / contract / applyLayout / setWidthMode / destroy`, plus
  `guessedHeaders`.
- Viewer chrome: `index.html` navbar (search + Clear + Balanced|Maximize +
  Expand + Contract + Row 1 = header + Open) and `src/app/app.js`. Footer
  `#status` (lower-left) is where the grid writes row counts.
- Version in three JS places: `VERSION` in app.js, `sw.js` cache name,
  `package.json`. Rebuild `dist/` (`npm run build`) after any `src/grid/`
  change — it also refreshes the python package's embedded umd+css. Smoke
  test: `node dev/smoke-test.mjs` (164 checks at 3.1.0).

## Global tweaks: round to powers of two

Author's call, treat as trivial:

- `WIDTH_SAMPLE`: **2000 → 2048** (2¹¹).
- default `renderCap`: **2000 → 2048** (2¹¹).
- `eagerCells`: **200000 → 262144** (2¹⁸).

Update the jsdoc to match. **Do NOT touch** the `fixYear` century base
(`2000 + y` / `1900 + y`) — different meaning. The year-detection range
(1800–2100) is unrelated and also stays.

---

## Stage A — inference quality (core.js only, no UI)

All four items are pure `core.js`/`util.js`, smoke-testable, low risk, and
cost ~nothing at startup (cheap checks inside loops that already run).
Files ≤ 2048 rows are unaffected except null-token blanking, because the
stride sample returns all rows when `n ≤ k`.

### A1 — null tokens (NaN / NA / etc. don't demote a numeric column)

- New in core.js: `const NULL_TOKENS = new Set([...])` and
  `isNullToken(s)` (case-insensitive). Token list (settled):
  `nan, na, n/a, #n/a, null, none, -, --, .` (compared on the trimmed,
  lower-cased string). Conservative and documented — no fuzzy threshold.
- `inferColumns`: treat a null-token cell exactly like a blank — skip it,
  don't count toward `seen`, never demote on it.
- `formatCell` (util.js): return `''` when `isNullToken(raw)` so `NaN`/`NA`
  render as empty cells, not the literal token. (Import `isNullToken` from
  core; it's the only new per-rendered-cell check — negligible.)

### A2 — sample-based numeric/date type decision (Steve's call)

Decide a column's **type** from the 2048-row stride sample, not every row,
so a lone oddball deep in a 250K file can't demote a clearly-numeric
column.

- `inferColumns`: take `sampleIndices(rows.length, 2048)`; a column is
  `number` if every non-blank, non-null-token sampled cell parses as a
  number; else `date` by the same test; else `text`.
- Then build the `values` array over **all** rows as today (parse → value,
  blank/null-token → `null`, **otherwise `null` too**). A non-sampled cell
  that doesn't parse becomes `null` → `formatCell` renders its **raw
  string verbatim** (existing behavior) → data is never hidden; it just
  isn't formatted, and sorts as a blank (last).
- TRADEOFF (accepted, documented): a column whose character changes after
  row 2048 (numeric early, text late) types as numeric; the late text
  cells show raw and unformatted rather than demoting the whole column to
  text. Matches "best we can." Small files: sample = all rows, identical
  to today.

### A3 — identifier integer columns → no commas (header regex only)

- New `ID_TITLE_RE` in core.js (word-boundary, case-insensitive):
  `id|no|num|number|account|acct|code|zip|postal|phone|fax|ssn|ein|tin|
  invoice|inv|ref|reference|sku|upc|isbn|order|customer|cust|member|
  policy|claim|seq`.
- `classifyNumber`, all-integer branch, precedence: **year → identifier →
  money → int**. Identifier match → a plain-integer format (no commas,
  0dp). Implementation: new format value `'plain'` rendered as `String(v)`
  in `formatCell` (one line; clearer than reusing `'year'`). Right-aligned
  like other numbers.
- **No content heuristics** — header regex only, per Steve. Documented so
  a surprise is explainable.

### A4 — leading-zero codes → text

- In `inferColumns` type decision: if any sampled, non-blank cell matches
  `/^-?0\d/` (leading-zero integer like `007`, `01234` — excludes `0`,
  `0.5`), force the column to **text** so the zero is preserved verbatim.
  Cheap regex inside the sample pass.

### A5 — date US/UK: keep the guess, add an ambiguity note

No behavior change to parsing (Steve likes it): per column, month-first by
default; any value with day > 12 flips the column to day-first; display
always ISO. We document it as "best effort; ambiguous all-numeric dates
default to US m/d/y; a column that is genuinely 3/4-vs-4/3 throughout is
unknowable."

- `inferColumns`: for date columns, set a flag `ambiguousOrder = true` iff
  the column used the all-numeric form (`NUMDATE_RE`), **nothing forced
  the order** (no value had a day/month part > 12, `dayFirst` stayed
  false), and at least one such ambiguous value was seen. ISO and
  month-name columns are never ambiguous.
- Grid exposes `ambiguousDateCols` (array of column names). Footer note,
  **lower-right** (new right-aligned element in `index.html` footer; grid
  exposes the list, app renders it; the grid's own `statusBar:true` mode
  appends it right-aligned): e.g. *"Dates in Open Date, Close Date read as
  US m/d/y (ambiguous)."* Shown only when the list is non-empty. Truncate
  the name list if long. Do not over-rotate.

### Stage A tests

Smoke-test additions: null-token columns stay numeric and render blank;
sample-tolerant typing (numeric column with one trailing text cell stays
numeric, oddball renders raw); identifier headers get no commas; year
still beats identifier; leading-zero columns stay text; `ambiguousOrder`
true/false on fixtures (pure US m/d/y vs a column with a day>12). New
fixture rows in `dev/sample.csv` or a dedicated fixture.

---

## Stage B — export (Copy + Save). One unit.

Shared serializers; Copy and Save differ only in sink (clipboard vs file).

### B1 — serializers (util.js)

- `toCSV(headers, rows2d)` — RFC-4180: quote a field iff it contains
  `" , \r \n`; double embedded quotes. `\r\n` line endings.
- `toMarkdown(headers, rows2d, aligns)` — pipe table; second row is the
  alignment spec from each column's type/align (`--:` number/date-right,
  `:-:` center for dates if we keep date-centering, `:--` text); escape
  `|` as `\|` in cells. Outer pipes included.

### B2 — grid methods

- `grid.export({ scope, format, values })` returning a string, where
  `scope ∈ {view, all}`, `format ∈ {csv, md}`, `values ∈ {raw, formatted}`.
  - `view` = `this.view` order (current filter + sort).
  - `all` = every row, **original file order, unfiltered** (predictable;
    not the current sort).
  - `raw` = cells straight from `this.rows`.
  - `formatted` = `formatCell` per cell (cheap; `Intl` cached).
- Gate: `formatted` is only offered when the target row count **≤ 2048**
  (Steve: formatted available for small tables only) — keeps the click
  instant, avoids formatting 250K cells on demand. Above 2048 the
  formatted option is disabled; raw still works at any size.

### B3 — chrome (index.html + app.js)

Defaults that match the data's purpose, with one override:

- **Copy** = split-button. Primary click = *Copy view as CSV (raw)*. Caret
  menu: view→CSV, view→Markdown, all→CSV, all→Markdown, plus a single
  **Values: raw ⇄ formatted** toggle (default raw, disabled when the
  relevant count > 2048). CSV defaults raw, Markdown defaults formatted
  (≤2048), both follow the toggle when set.
- **Save** = split-button, same four scope×format actions; Blob +
  `<a download>`. Primary = *Save view as CSV*. Filename from
  `loadedFileName` (strip extension, add `.csv`/`.md`), fallback
  `table.csv`.
- Encoding: **UTF-8**. CSV save gets a **UTF-8 BOM** (Excel friendliness;
  we strip BOM on input so round-trip is clean) — recommended default,
  trivial to drop. Clipboard copy and Markdown: no BOM.
- Clipboard via `navigator.clipboard.writeText` (https/localhost/PWA; the
  app already runs there). Brief "Copied" affordance.

### Stage B tests

Smoke test: `toCSV`/`toMarkdown` quoting/escaping/alignment; export scope
ordering (view respects filter+sort, all is original order); raw vs
formatted; BOM presence on CSV-save string only.

---

## Stage C — responsive toolbar (after B, so it can place Copy/Save)

Fixes Open jumping to a second row. Approach: **breakpoint-static "More"
dropdown**, no JS width-measuring (predictable; the dynamic priority-plus
pattern is rejected as fragile/over-built for this).

- **Always visible core**: search box, **Clear**, **Balanced | Maximize**,
  **Expand**, **Contract** (Steve's quintet). Labels already collapse to
  icons below `lg` (3.1).
- **Lower priority** → fold into a right-aligned **"⋯ More"** dropdown
  below a chosen breakpoint: **Open**, **Row 1 = header**, **Copy** set,
  **Save** set.
- To avoid nested dropdowns and JS, render two layouts wired to the **same
  handler functions**: wide layout shows Copy/Save split-buttons + Open +
  Row 1 inline (`d-none d-xl-flex`); narrow layout shows a single "⋯ More"
  dropdown (`d-xl-none`) whose menu lists Open, Row 1 = header, and the
  Copy/Save actions as flat sectioned items + the raw/formatted toggle.
  Markup is duplicated; logic is shared. Tune the breakpoint during build.
- TRADEOFF: a little duplicated markup vs a robust, jitter-free bar. OPEN:
  exact breakpoint (`xl` vs `lg`) — decide visually during build.

---

## Order, deliverables, housekeeping

1. **A** (core inference + 2048) — independent, lands first.
2. **B** (export) — adds Copy/Save buttons.
3. **C** (responsive) — organizes B's buttons.

Each stage: rebuild `dist/` (`npm run build`, refreshes python embedded
assets), keep smoke test green, bump the three JS version spots to
**3.2.0**. Stage A changes grid behavior the python package re-emits via
the rebuilt umd, so bump `python` `__version__`/`pyproject` too (no python
code change). CHANGELOG `## 3.2.0` at the close; README only if the export
surface warrants a mention; `human-hints.md` updated each session.

## Settled vs OPEN

Settled: raw default + formatted gated ≤2048; null-token list; A2
sample-based typing with raw-passthrough; A3 header-regex only; A4
leading-zero→text; A5 keep guess + lower-right ambiguity note; 2000→2048;
CSV-save BOM; version 3.2.0; column-stats popover **out of scope**
(Steve: nice but low priority, skip).

OPEN (decide during build): exact toolbar breakpoint; final ID_TITLE_RE /
NULL_TOKENS word lists (start from the above); whether "all" export honors
the current sort (default: no — original order).
