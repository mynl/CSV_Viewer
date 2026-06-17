---
title: "csv-viewer — the formatting algorithm"
subtitle: "Every assumption and transformation the grid makes, and where it lives in the code"
---

# The formatting algorithm

This page documents **exactly** what the
grid assumes about your data and what it does to it, and points at the line
of code where each decision is made. The grid bakes in one person's
(actuarial, [greater_tables](https://github.com/mynl/greater_tables_project))
formatting opinions on purpose — there is no config surface. If those
opinions are wrong for you, this doc tells you which function to fork.

Worked, runnable versions of everything here live in
[examples.md](examples.md) (Python emitter). Section links point there.

All references are to `src/grid/core.js` (pure data logic: parse, infer)
and `src/grid/util.js` (pure display logic: format, widths). Both are
DOM-free and side-effect-free; the same code runs on the page and inside
the worker.

---

## Summary

The pipeline, end to end (`processData`, `core.js:491`):

```
raw text
  → clean (strip BOM + leading blank lines)           core.js:14
  → markdown-table? ─yes→ parse pipe table            core.js:115
       │no
  → sniff delimiter (, \t ; |)                        core.js:20
  → parse RFC 4180                                    core.js:53
  → header row? (auto: row 1 is data if any cell      core.js:274
       parses as number/date)
  → infer each column's TYPE from a 2048-row sample   core.js:404
  → build typed values over ALL rows                  core.js:439
  → choose number FORMAT per column                   core.js:321
  → (display) format each cell on demand              util.js:86
  → (layout) solve column widths once                 util.js:258
```

**Three column types**, decided per column: `number`, `date`, `text`.
Type drives **alignment** (numbers right, dates center, text left) and
**sort** (by value, not by string). Type is decided from a *sample*; a lone
unparseable cell does **not** demote the column — it just renders raw.

**Number format** is one of six, chosen by `classifyNumber` (`core.js:321`)
in this priority order:

| Format | When | Renders | §ref |
|---|---|---|---|
| `year` | all-integer **and** (header matches `year/yr/vintage/cohort` **or** every value in 1800–2100) | `1995` — no commas | [Years](#years-vs-integers) |
| `plain` | all-integer, identifier header (`id/no/account/zip/…`), **not** also money | `100200` — no commas | [Identifiers](#identifiers-plain-integers) |
| `int` (money 2dp if money header) | all-integer otherwise | `1,200` / money `1,234.50` | [Integers](#integers) |
| `pct` | float, ratio header (`ratio/rate/roe/lr/…`) **and** max\|x\| ≤ 2 | `0.625 → 62.5%` | [Percents](#percents-the-ratio-rule) |
| `eng` | float spanning > 6 orders of magnitude | `4.5M`, `1.2m` (SI) | [Engineering](#engineering-format) |
| `float` | float otherwise; money → 2dp, else uniform decimals from magnitude | `1,234.50` / `0.625` | [Floats](#floats-and-the-decimals-rule) |

**Two precedence layers above all inference** (you almost never need to
read source to override — pass options):

1. inference (everything in this doc) — the defaults.
2. an explicit per-column `format`/`fmt` spec and/or `align` string — wins
   over inference, no code change. See [Overrides](#overriding-the-magic).

**The format mini-language** (`parseFormatSpec`, `util.js:33`):
`[,][.N](f|d|%|e|s)` plus named `year` and `eng`. e.g. `,.2f`, `.1%`,
`,d`, `.3s`. This is the escape hatch — any column you don't like, name a
spec.

**Data integrity guards** (these protect correctness, not taste — think
twice before forking them):

- Integers past 2⁵³ keep the column **text** so digits survive verbatim
  (`isUnsafeBigInt`, `core.js:185`).
- A significant leading zero (`007`) forces **text** so the zero survives
  (`LEADING_ZERO_RE`, `core.js:393`).
- Null tokens (`NaN`, `NA`, `-`, …) are **missing**, never data
  (`NULL_TOKENS`, `core.js:146`).

**Column widths** are solved once per load by an equal-risk (Value-at-Risk)
allocation — every column truncates with the same probability — or a
coverage maximizer (`solveWidths`, `util.js:258`).

Everything below is the long version.

---

## 1. Parsing

### Cleaning (`cleanCsvText`, `core.js:14`)
Strips a leading UTF-8 BOM and any leading blank/whitespace-only lines.
**Why:** bank downloads routinely carry both, and a leading blank line
makes the file look single-column.

### Delimiter sniffing (`sniffDelimiter`, `core.js:20`)
Candidates: `,` `\t` `;` `|`. Scores the first ~20 lines by per-line field
count; the candidate with the highest, most *consistent* count (> 1) wins
(consistency multiplies the score by 10). Quote-aware (`splitLine`,
`core.js:36`). **Assumption:** the delimiter is one of those four and the
file is rectangular enough that the first 20 lines agree.

### RFC 4180 parse (`parseCSV`, `core.js:53`)
Full RFC 4180: quoted fields, doubled `""` quotes, embedded delimiters and
newlines, CRLF or LF. Trailing fully-blank lines are dropped. Ragged rows
are normalized to header length later (`processData`, `core.js:511`):
truncated if long, padded with `''` if short. → [Examples: RFC 4180
strings](examples.md#rfc-4180-strings).

### Markdown pipe tables (`isMarkdownTable`, `core.js:106`)
If the first non-blank line has a `|` and the second is an alignment
separator row (every cell like `---`, `:--`, `:-:`, `--:`), the text is
parsed as a GitHub-flavored pipe table (`parseMarkdownTable`, `core.js:115`)
**instead of** CSV. The separator row's `:` markers set explicit column
alignment that overrides the type-based default. Escaped `\|` inside a cell
is honored.

## 2. Header detection (`looksHeaderless`, `core.js:274`)

Auto rule (when the caller doesn't force it): **row 1 is data, not headers,
if any cell in it parses as a number or a date.** Real headers are text.
An all-text first row is ambiguous and is kept as the header. A headerless
file gets synthesized `col1, col2, …` names, then `guessHeaders`
(`core.js:284`) renames columns by inferred type — `Date`, `Amount`
(`Year` for year-formatted integers), `Description`, numbered when a type
repeats. **Why:** bank exports often have no header row.
→ [Examples: Bank exports](examples.md#headerless-bank-exports).

## 3. Type inference (`inferColumns`, `core.js:404`)

### Sampling
The **type** decision reads a deterministic stride sample of up to
`INFER_SAMPLE = 2048` rows (`sampleIndices`, `core.js:384`), not every row.
**Consequence (important):** a lone oddball deep in a large file no longer
demotes an otherwise-clean numeric/date column. The stray cell is left
unparsed (value `null`) and renders raw via `formatCell` — **data is never
hidden**, but the column keeps its type. For files ≤ 2048 rows the sample is
every row, so behavior is exact. After the type is fixed, the typed
`values[]` array is built over **all** rows.

### The per-column decision
For each sampled, non-blank, non-null-token cell:

- starts assuming both `isNum` and `isDate`;
- `isNum` falls if `parseNumber` returns null;
- `isDate` falls if `parseDate(raw, false)` returns null;
- a numeric value with a significant **leading zero** (`007`, via
  `LEADING_ZERO_RE`) flags the column to **text** (a code, not a quantity)
  — gated to numeric values so zero-padded dates/times aren't misread;
- an integer-form value past 2⁵³ (`isUnsafeBigInt`) flags the column to
  **text** (digits would corrupt as a float64) — see below.

Resolution: leading-zero or big-int → `text` (big-int columns are
right-aligned, since they read as numbers); else `number` if all sampled
values parsed as numbers; else `date` if all parsed as dates; else `text`.

### Null tokens (`NULL_TOKENS`, `core.js:146`)
The set `{nan, na, n/a, #n/a, null, none, -, --, .}` (trimmed,
lower-cased). These mean **missing**: they never count toward or against a
type, never demote a numeric/date column, and render as **blank** cells.
Deliberately a small, conservative, documented list — no fuzzy threshold.
→ [Examples: Missing values](examples.md#missing-values).

### Big integers past 2⁵³ (`isUnsafeBigInt`, `core.js:185`)
JS numbers are IEEE-754 doubles; an integer above `Number.MAX_SAFE_INTEGER`
(2⁵³−1) cannot be held exactly, and distinct big values can collapse to the
same double — silent corruption. So **any column containing an integer-form
value past 2⁵³ is kept text** and its digits render verbatim. Pure lexical
test, no BigInt: ≤ 15 digits is always safe, 16 needs one string compare
against `MAX_SAFE_DIGITS`, 17+ is always unsafe. A `.` or exponent means an
inherently approximate float, which stays a number (`1.23e30` is fine). →
[Examples: Big integers](examples.md#big-integers-beyond-2).

## 4. Parsing a number (`parseNumber`, `core.js:154`)

Gate regex `NUM_RE` (`core.js:133`), then: parentheses → negative
(`(123)` → −123); leading `$` and thousands commas stripped; trailing `%`
→ divide by 100; scientific notation honored. Returns `{v, dec}` where
`dec` is the decimal count *implied by the source string* (exponent-aware;
`%` adds 2). That observed-decimals figure (`maxDec` across the column,
`core.js:446`) feeds the float decimals rule. **Assumption:** US
conventions — `,` is the thousands separator, `.` the radix point.

## 5. Choosing a number format (`classifyNumber`, `core.js:321`)

The heart of the opinions. Header-name regexes:

| Regex | `core.js` | Matches (case-insensitive) |
|---|---|---|
| `YEAR_TITLE_RE` | 297 | `year, yr, vintage, cohort` |
| `MONEY_TITLE_RE` | 298 | `amount, amt, balance, price, cost, premium, loss, salary, …` and `$£€` |
| `ID_TITLE_RE` | 302 | `id, no, num, account, code, zip, phone, ssn, invoice, policy, claim, …` |
| `PERCENT_TITLE_RE` | 309 | `ratio, rate, roe, lr, margin, yield, return, growth, cede, apr, pct, …` |

`PERCENT_TITLE_RE` uses letter-only boundaries `(?<![a-z])…(?![a-z])`
(**not** `\b`) so it fires inside `snake_case`/digits (`loss_ratio`, `lr3`)
while short tokens (`lr`, `roe`) don't bleed into longer words. **The other
three use `\b`** — and since `_` is a word character, they do **not** match
inside `snake_case`: `Account No` matches the id rule but `account_no` does
*not* (it would format as an `int` with separators). Use spaces, or widen
those regexes if you fork. This asymmetry is deliberate for percents
(snake_case ratio names are common) but is a sharp edge for the rest.

### Years vs integers
All-integer column → `year` if the header is year-ish **or** every value is
in **1800–2100** (inclusive — projection columns run decades ahead). Years
render plain, no commas. **The data-wins guard:** a header that *looks*
year-ish but holds, say, `-3,000,000,000` (a geologist's date) fails the
range test and isn't forced — but note the header regex alone is enough, so
`vintage = [10, 20, 30]` *would* format as years. → [Examples: Years](examples.md#years).

### Identifiers (plain integers)
All-integer, header matches `ID_TITLE_RE` and **not** `MONEY_TITLE_RE` →
`plain`: no thousands separators (account `100200`, not `100,200`).
Money words win the overlap on purpose (`Order Amount`, `Account Balance`
→ 2dp money). Header-text only — no value heuristic (author's call). →
[Examples: Identifiers](examples.md#identifiers).

### Integers
All-integer otherwise → `int` with thousands commas, except a money header
→ `float` 2dp ("deffo 2dp"). → [Examples: The number matrix](examples.md#the-number-formatting-matrix).

### Percents (the ratio rule)
Float column, header matches `PERCENT_TITLE_RE`, **and** max\|x\| ≤ 2 →
`pct`: a fraction shown as a percentage (`0.625 → 62.5%`). **The value gate
is the real guard,** not the name: a column already in percentage points
(`rate = 62`) has max > 2, fails the gate, and is **not** turned into
`6,200%`. Ranks *above* money so "loss ratio" isn't grabbed by the `loss`
money-word. Decimals: `clamp(maxDec − 2, 1, 4)` — the precision the data
carried, less the two places the ×100 shift consumes. → [Examples: The
ratio rule](examples.md#percents-the-ratio-rule).

### Floats and the decimals rule
Remaining floats:

1. money header → 2dp;
2. **money by value** — ≤ 2 observed decimals **and** max\|x\| < 100,000 →
   2dp;
3. span max\|x\|/min\|x\| > 10⁶ (6 orders) → `eng`;
4. otherwise uniform decimals
   `dec = clamp(3 − floor(log10(mean|x|)), 0, maxDec, 6)` — about **4
   significant digits at the column's typical magnitude**, never more
   precision than the raw data carried, capped at 6.

Magnitude stats are computed in a single loop (not `Math.max(...spread)` —
a 250k-row spread blows the stack). → [Examples: Floats](examples.md#floats).

### Engineering format
`engFormat` (`core.js:371`): 3 significant digits with SI suffixes `n µ m (none) k M G T` (exponent
clamped to −9…12, `ENG_SUFFIX`, `core.js:369`). Used for `eng` columns and
the `s`/`eng` format specs. → [Examples: Engineering format](examples.md#engineering-format).

## 6. Parsing a date (`parseDate`, `core.js:214`)

Tried in order: ISO `yyyy-mm-dd` with optional `T`/space time (`ISO_RE`);
numeric triples with `/ - .` separators, 2- or 4-digit years (`NUMDATE_RE`);
`5 Jan 2024` / `05-Jan-24` (`DMON_RE`); `Jan 5, 2024` (`MOND_RE`).
`makeDate` (`core.js:204`) round-trips through a real `Date` to reject
invalid calendar dates (`2/30`, `4/31`, non-leap `2/29`). Month names via
`monthNum` (`core.js:195`), prefix-matched (`sept` special-cased).

### Two-digit year pivot (`fixYear`, `core.js:202`)
`< 50 → 20xx`, else `19xx`. So `24 → 2024`, `76 → 1976`, `00 → 2000`.

### Day-first vs month-first (per column, `core.js:454`)
The all-numeric `05/01/2024` case is resolved **per column**, not per value
(`numDateOrder`, `core.js:254`):

- a value with first part > 12 → must be **day-first** (UK); the whole
  column re-parses day-first;
- a value with second part > 12 → must be **month-first** (US);
- all values ≤ 12/12 → genuinely **ambiguous**; defaults to US m/d/y and
  the column is flagged `ambiguousOrder` so the viewer shows a
  "read as US m/d/y (ambiguous)" note.

→ [Examples: Date inference](examples.md#date-inference).

## 7. Displaying a cell (`formatCell`, `util.js:86`)

Trimmed; empty → `''`. In `raw` display mode (the lens), returns the
verbatim source for any non-blank cell — no rules at all; type still drives
alignment and sort. In `auto` mode:

- **number**: `null` value → blank if a null token, else the raw string (a
  stray non-numeric value, never hidden). Then, in order: explicit
  `col.fmt` spec wins; `year`/`plain` → bare `String(v)`; `eng` →
  `engFormat`; `pct` → `value×100` + `%`; else thousands-grouped to
  `col.dec` decimals.
- **date**: ISO `yyyy-mm-dd`, plus ` HH:MM` only when the column has any
  non-midnight time (`hasTime`). Center-aligned. Date **display** format is
  fixed ISO — there is intentionally no date format spec.
- **text**: the raw string.

`Intl.NumberFormat` is ~100× the cost to construct vs. to call, so one
formatter is cached per decimal count (`NF_CACHE`, `util.js:17`) — never
per cell.

## 8. The format mini-language (`parseFormatSpec`, `util.js:33`; `formatWithSpec`, `util.js:46`)

A deliberately small subset of the [Python format
spec](https://docs.python.org/3/library/string.html#format-specification-mini-language)
/ [d3-format](https://d3js.org/d3-format) grammar — the part that matters
for tabular numbers. The full grammar is just:

```
[,][.N](f|d|%|e|s)        plus the two named specs:  year   eng
 │    │   └─ presentation type
 │    └──── precision: N digits after the point
 └───────── thousands grouping
```

If you know Python f-strings, you already know this — it is the part of
`format(x, "<spec>")` after the colon, with the same letters. Taking
`x = 1234.56`:

| This spec | Python f-string | `1234.56` → |
|---|---|---|
| `,.2f` | `f"{x:,.2f}"` | `1,234.56` |
| `.1f` | `f"{x:.1f}"` | `1234.6` |
| `,d` | `f"{round(x):,d}"` | `1,235` (rounded) |
| `.1%` | `f"{x:.1%}"` | `123456.0%` (×100; add `,` to group) |
| `.2e` | `f"{x:.2e}"` | `1.23e+3` (Python prints `1.23e+03`) |
| `.3s` | d3's `~s` (no f-string letter) | `1.235k` (3 decimals + SI) |
| `eng` | — | `1.23k` (3 **sig figs**, zeros dropped) |
| `year` | `str(int(x))` — no grouping | `1234` |

Note the last three on the same value: `.3s` fixes **three decimals**
(`1.235k`), while `eng` (and bare `s`) gives **three significant figures**
with trailing zeros dropped (`1.23k`). Rounding sits on JS's `toFixed`/`Intl`
(round-half-to-even for the grouped paths), which can differ from Python's
`round` on exact `.5` ties — don't lean on tie behavior.

Per spec char (`formatWithSpec`, `util.js:46`):

| Char | Meaning | `.N` default | Notes |
|---|---|---|---|
| `f` | fixed-point | `2` | `,` adds grouping |
| `d` | integer | — | value is **rounded** first |
| `%` | ×100 then `%` | `0` | same ×100 as Python `%` |
| `e` | scientific | `2` | JS `toExponential`, `e+03` style |
| `s` | SI suffix | `engFormat` (3 sig) | with `.N`, fixed `N` decimals + suffix |
| `year` | plain integer, no grouping | — | named spec, not a char |
| `eng` | engineering/SI, 3 sig figs | — | named spec; `s` without `.N` |

Differences from Python worth knowing:

- **Grouping** is just a leading `,` (no `_` option, no locale; output is
  always `en-US` `1,234.56`).
- **`%`** matches Python (×100, appends `%`): a *fraction* `0.625` → `62.5%`.
  A column already in points (`62.5`) becomes `6,250%` — that is on you, the
  spec does no gating (unlike the auto percent rule, §5).
- **`s`** is d3's SI suffix, not Python's. Bare `.s`/`eng` gives 3
  significant figures with trailing zeros dropped (`8000` → `8k`); `.2s`
  forces two decimals (`8000` → `8.00k`).
- No sign/fill/width/align fields (`+`, `0`, `>10`, …) — column **alignment**
  is set separately (§9), and width is the layout solver's job (§10).
- **Dates have no spec** — display is fixed ISO (§7). A date format string
  is intentionally out of scope.

An unrecognized spec **throws** (`parseFormatSpec`, `util.js:37`) — it's a
programming error in your option list, not bad data, so it fails loudly
rather than silently mis-formatting. This is the per-column override
(§[Overriding the magic](#overriding-the-magic)). → [Examples: The format
mini-language](examples.md#the-format-mini-language).

## 9. Alignment (`cellClass`, `util.js:397`; `parseAlignSpec`, `util.js:77`)

Default by type: number → right, date → center, text → left. An `align`
string (`'llrcr…'`, one char per column, l/r/c) or a markdown alignment row
overrides it; any other character keeps the type default. Alignment is
**independent of the display lens** — `raw` mode and explicit `fmt` change
the text, not the alignment or the sort key (`col.values`).

## 10. Column widths (`solveWidths`, `util.js:258`)

Solved **once per load** from a sampled per-column distribution of rendered
cell widths, then frozen with respect to filtering. Floors: `MIN_COL = 50`
px, plus `CELL_PAD = 18` px padding (`util.js:250`). Two regimes are shared:
**tight** (everything fits → natural widths) and **floors + horizontal
scroll** (nothing fits). They differ only in the squeeze:

- **equal-risk** (default, `equalRiskWidths`, `util.js:267`) — a
  Value-at-Risk allocation: bisect for the single percentile `q` such that
  the per-column `q`-th-percentile widths (floored) sum to the available
  width. Every column then truncates with the **same probability** `1 − q`.
- **coverage** (`coverageWidths`, `util.js:295`) — maximize the *count* of
  cells shown in full: `max Σ_j F_j(w_j)` s.t. `Σ w_j ≤ avail`, solved by a
  greedy water-fill along each column's upper concave envelope
  (`concaveEnvelope`, `util.js:326`) — buy width by steepest marginal
  cells/px first, equalizing the cutoff slope λ. Completes cheap thin-tail
  columns and concentrates truncation on the few expensive outliers.

Both are derived from scratch, with references, in
[column-width.md](column-width.md). → [Examples: Width
modes](examples.md#width-modes).

---

## Overriding the magic

You do **not** need to touch source to change a column's treatment. In
priority order, lowest to highest:

1. **inference** — everything above.
2. **explicit `format`/`fmt`** — a per-column array of specs (or `None`/`null`
   to keep auto). Wins over inference. e.g. force a 3-decimal SI column
   with `.3s`, or a percent with `.1%`.
3. **explicit `align`** — a per-column `'llrcr…'` string. Wins over the
   type default.
4. **`display_mode='raw'`** — bypass all formatting, show verbatim source
   (type still drives alignment/sort).

In the Python emitter these are `fmt=[…]`, `align='…'`, `display_mode='raw'`
(see [examples.md](examples.md#overriding-the-magic)); the JS API and R
wrapper expose the same option names.

## Forking the opinions

If the override surface isn't enough and you want different *defaults*, the
table below is where to cut. Everything is pure and DOM-free, so a fork is
local — no DOM, state, or worker plumbing to chase.

| You want to change… | Edit | Notes |
|---|---|---|
| which header words mean money/id/ratio/year | the four `*_TITLE_RE` regexes, `core.js:297`–`309` | letter-only boundaries for the percent rule — see §5 |
| the percent value gate (≤ 2) | `classifyNumber`, `core.js:355` | this is taste, safe to change |
| the float decimals rule (4 sig digits) | `classifyNumber`, `core.js:364` | |
| money-by-value thresholds (2dp, < 100k) | `classifyNumber`, `core.js:361` | |
| the eng/SI span trigger (6 orders) | `classifyNumber`, `core.js:362` | |
| the year range (1800–2100) | `classifyNumber`, `core.js:326` | |
| null-token set | `NULL_TOKENS`, `core.js:146` | conservative on purpose |
| the inference sample size (2048) | `INFER_SAMPLE`, `core.js:392` | speed/accuracy trade |
| date display (ISO, HH:MM) | `formatCell`, `util.js:104`–`108` | |
| the two-digit year pivot (50) | `fixYear`, `core.js:202` | |
| add a format spec char | `parseFormatSpec`/`formatWithSpec`, `util.js:33`/`46` | |
| width allocation policy | `solveWidths`, `util.js:258` | the two squeezes |
| **the 2⁵³ big-int guard** | `isUnsafeBigInt`, `core.js:185` | **integrity, not taste — don't** |
| **the leading-zero guard** | `LEADING_ZERO_RE`, `core.js:393` | integrity — think twice |

After editing anything in `src/grid/`, rebuild the library
(`npm run build`) and re-run the smoke test (`node dev/smoke-test.mjs`) —
`dist/` and the Python package's embedded assets are committed and do
**not** auto-update.
