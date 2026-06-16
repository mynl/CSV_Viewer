# plan-3.3 — big-int integrity, percent ratios, raw display mode

Version target: **3.3.0** (additive; D1 is a correctness fix). Continues the
A–C stage lettering of 3.2, so this is **Stage D** in three parts. D1 and D2
are pure `core.js`/`util.js` inference; D3 is grid + chrome. Author handles
commits; bump version only when code lands. Decisions below are settled
unless marked OPEN.

## Context snapshot (survives a /clear)

- Type inference: `inferColumns` in `src/grid/core.js` decides number/date/
  text from a stride sample of `INFER_SAMPLE = 2048` rows, then builds values
  over all rows. Already forces text on null tokens (`isNullToken`) and
  significant leading zeros (`LEADING_ZERO_RE`). `classifyNumber` picks the
  number format: allInt → year → (id & !money) → money → int; floats → money
  (title) → money (value) → eng → sensible-float.
- Display: `formatCell` in `src/grid/util.js`. Format primitives include a
  `%` case in `formatWithSpec` (the explicit spec mini-language already does
  percent), and `engFormat`. `cellClass(col)` emits `col-<type>` plus
  `align-<col.align>` when `col.align` is set — so a column can be given an
  explicit alignment independent of its type.
- Grid: `CsvGrid` (`src/grid/grid.js`) caches formatted rows lazily
  (`this.formatted`, `getFormattedRow`), measures widths from formatted text
  (`measureLayout`), and builds the search index from formatted+raw text. It
  keeps the raw cells in `this.rows`. The viewer keeps the cleaned source in
  `rawText` (app.js) for the header re-interpret.
- Chrome: `index.html` toolbar + `src/app/app.js`. Stage C gave it four
  responsive phases; the `Balanced | Maximize` segmented control
  (`#fit-group`, `setFit`) is the model for any new two-state control, and
  the `⋯ More` dropdown folds lower-priority controls below `lg`.
- The formatting decision tree is documented in README ("How formatting is
  decided") and `human-hints.md` (pinned). Both update when D lands.

---

## D1 — preserve integers beyond 2^53 (correctness fix)

**Problem.** `parseNumber` runs everything through float64, so an integer
above `Number.MAX_SAFE_INTEGER` (`9,007,199,254,740,991`) is silently
rounded, and *distinct* values can collapse to the same float (a list of
large primes renders with duplicate/round digits). That is data corruption,
not formatting.

**Fix.** An integer-form token whose magnitude exceeds 2^53 cannot be an exact
double, so such a column is treated as **text** and the digits render
verbatim. Limited to integer-form tokens (no `.`, no `e`): a float like
`1.23e30` is inherently approximate and stays a number.

- New helper in core.js, e.g. `isUnsafeBigInt(s)`: strip sign + commas; if all
  digits and (`len > 16` || (`len === 16` && string compares above
  `"9007199254740991"`)), it is unsafe. **Pure string test — no `BigInt`**,
  because ≤ 15 digits is always safe (10¹⁵ < 2⁵³) and 16-digit needs one
  lexical compare. Negligible cost; runs inside the existing sample loop.
- `inferColumns` type decision: an unsafe big-int sampled value forces the
  column to text (same path as `LEADING_ZERO_RE`).
- **Alignment (settled): right-align these text columns** — they read as
  numbers even though stored as strings. Set `col.align = 'right'` when the
  column is forced text *because of* a big-int (not for ordinary text). The
  `align-right` class already exists via `cellClass`.
- Caveat (accepted): text columns lose the numeric `>`/`..` filters; sort
  still orders correctly via the `numeric:true` collator (handles
  arbitrary-length digit strings by magnitude). Worth a one-line README note.
- Synergy: long account/ID numbers above 2⁵³ correctly become exact text too.

Tests: a 30-digit and a 16-digit-above-max value force text + right align;
`9007199254740991` stays a (safe) number; floats with big exponents stay
numbers. Refresh `tests/csv/curated/giant-ints.csv` expectations + README.

Coding **S**; startup **~0**.

## D2 — percent format for ratio columns

**Goal.** Ratio/rate columns (ROE, COC, LR, combined ratio, …) stored as
fractions display as percentages: `0.625 → 62.5%`, `1.04 → 104.0%`.

- New `PERCENT_TITLE_RE` in core.js. Starting word list (OPEN, curated):
  `ratio|rate|roe|roa|coc|lr|elr|plr|margin|yield|return|growth|retention|
  cede|ceded|discount|apr|apy|coupon|util|utilization|share|pct|percent|
  severity|frequency`. Short tokens (`lr`, `coc`, `roe`) matched on `\b…\b`
  so they don't bleed into other words.
- Applies in `classifyNumber`, **floats only** (all-integer ratio columns are
  too ambiguous about units — skip). Precedence: it must beat money, so the
  float order becomes **percent → money(title) → money(value) → eng → float**
  (else `loss_ratio` is caught by `loss` in the money regex).
- **Value gate (settled):** only when `max|value| ≤ 2.0` (≤ 200%). Author's
  expectation is values in roughly −1…2, not floored at 0; outside the gate
  the column keeps its float/money format (a `rate` column stored in
  percentage points like `62` is not ×100'd into `6,200%`).
- New format value `'pct'`; `formatCell` renders `(v*100)` with a `%` (the
  `%` machinery exists in `formatWithSpec`). Right-aligned like other numbers.
- Decimals (OPEN — **verify against greater_tables before finalizing**, per
  the standing formatting rule). Proposed start:
  `dpct = clamp(maxObservedDecimals − 2, 1, 4)` (uniform per column) →
  `0.625 → 62.5%`, `0.1523 → 15.23%`, `1.04 → 104.0%`.
- Note: a trailing `%` in the *source* already parses to a fraction
  (`12.5% → 0.125`), so a `%`-suffixed ratio column round-trips back to
  `12.5%` under this rule.

Tests: ratio headers in-range → pct with correct dp; ratio header out of
range (`>2`) → stays float/money; percent beats `loss`/money; non-ratio float
unchanged. Add a `ratios.csv` curated fixture (ROE/LR/combined/out-of-range).

Coding **S**; startup **~0** (one regex + range check per column at load).

## D3 — raw display mode

**Goal.** A global toggle that turns off format *selection* while keeping
type inference, so cells show their **source text verbatim** (no separators,
no 2dp, no ISO normalization, no eng/percent) but still align and sort by
type. The escape hatch when the heuristics aren't wanted or exact source is
needed. Orthogonal to D1/D2 (those fix the default *auto* mode).

- Grid: new option `displayMode: 'auto' | 'raw'` (default `'auto'`) and a
  `setDisplayMode(mode)` method that clears `this.formatted`, re-measures
  widths, rebuilds the search index lazily, and re-renders — **no re-parse**
  (reuses `this.rows`/`this.cols`).
- `formatCell` (or a wrapper) gains a raw branch: return the trimmed source
  string for any non-blank cell; blanks stay blank. Type is unchanged, so
  alignment (numbers right, dates center, big-int right) and sort still work.
- Definition of "raw" is **identical** to the export `values: 'raw'` path
  (source string), but display-mode and export-mode stay **independent**:
  the view defaults to Inferred (readability) while export defaults to raw
  (fidelity, settled in 3.2) — different use cases, so no coupling. Shared
  raw/formatted vocabulary, separate defaults.
- Chrome (settled): the control lives in the **footer** (`#status-bar`), NOT
  the top toolbar — deliberately a different category from the layout
  controls (widths/expand), and a less-exercised option that shouldn't take
  prime real estate. The fixed footer is always on screen, so it's reachable
  without scrolling even on huge files, next to the row-count / "showing
  first N" status. This **avoids** growing the quintet, folding into More, or
  nudging the label-collapse breakpoint.
  - A **two-state labeled slider/switch** `Inferred ⟷ Raw`, default
    **Inferred** (not a meaning-flipping button — both positions labeled).
    Wired to `setDisplayMode`. Sublime-style: mode switch parked bottom-right.
  - **Layout:** `#status` (row counts) left and flex-growing (truncates with
    ellipsis if needed); a right cluster holds the ambiguous-date note then
    the slider, **slider rightmost**. Putting the note to the *left* of the
    slider keeps the slider pinned in one spot — it doesn't shift when the
    note appears/disappears; the note just grows leftward into the status
    whitespace. On a phone the status truncates first; the slider stays
    visible.
  - Footer is thin (0.75rem, 3px padding) — needs compact styling and likely
    a small height bump for the switch.
- OPEN: suppress the ambiguous-date footer note in raw mode (no
  reinterpretation is happening) — lean **yes**. Label nuance: footer says
  "Inferred", export menus say "formatted" — same idea, unify later if it
  grates.
- Performance: default `auto` so startup is unchanged; raw is the cheaper
  render path; the re-measure on toggle is an explicit user action (and for
  very large files is a fraction of the original parse cost).

Tests (smoke covers logic; raw display itself is grid/DOM): `formatCell` raw
branch returns source for number/date/text incl. big-int and `2/30/2020`;
type/align unaffected. Manual: toggle on `numbers.csv` / `giant-ints.csv`.

Coding **M** (the only non-trivial piece — display-mode plumbing, width
re-solve, the footer control); startup **~0**.

---

## Order, deliverables, housekeeping

1. **D1** (big-int) — standalone correctness fix, lands first.
2. **D2** (percent) — needs the greater_tables decimal check + word-list sign-off.
3. **D3** (raw mode) — grid + chrome.

Each: rebuild `dist/` (`npm run build`, refreshes the python embedded
assets), keep `node dev/smoke-test.mjs` green, bump the three JS version
spots to **3.3.0** (+ python `__version__`/`pyproject` since the rebuilt umd
re-emits behavior). Update the README "How formatting is decided" section
(fold D1/D2 into the rules, document D3), the pinned `human-hints.md` rules,
new/updated curated fixtures (`giant-ints.csv`, `ratios.csv`), and a
`## 3.3.0` CHANGELOG section at the close.

## Settled vs OPEN

**Settled:** D1 forces text + **right-aligns** big-int columns (string test,
no BigInt); D2 percent gate `max|x| ≤ 2.0`, floats only, precedence before
money; D3 raw = verbatim source with type-based align/sort, exposed as a
two-state `Inferred | Raw` control **in the footer** (not the top toolbar),
default Inferred, independent of export's raw/formatted; version 3.3.0.

**OPEN (decide during build):** D2 final `PERCENT_TITLE_RE` word list and the
percent **decimal rule (verify greater_tables)**; D3 whether the
ambiguous-date note is suppressed in raw mode (lean yes), and segmented-pair
vs switch styling for the footer control; whether D1's right-align is worth a
dedicated `col.numericText` flag vs reusing `col.align`.

## Future / backlog (not 3.3)

- **Per-column raw.** A surgical "show this column's source" instead of the
  global lens — wants column-header UI (menu / control) we don't have yet, so
  it's a larger feature. Revisit after D1/D2 (which already fix the common
  single-column culprits: big-ints and ratios) and the global D3 land. ~3.4.
