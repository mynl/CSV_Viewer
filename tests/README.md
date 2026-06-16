# tests/

Test data for csv-viewer. Two kinds:

- **`csv/curated/`** — small, hand-built fixtures, **committed**, each one
  exercising a specific corner of parsing / inference / formatting. These
  are the ones to open by hand when poking at behavior. Also handy as
  `?src=tests/csv/curated/<file>` while serving the repo.
- **`csv/*.csv`** (top level) — large volume / perf fixtures (10–250k rows,
  multi-MB). **Git-ignored** (`tests/**/*.csv`) so they don't bloat the
  repo; regenerate locally as needed. The `curated/` subfolder is the lone
  committed exception (see `.gitignore`).
- **`md/`** — markdown pipe-table fixtures (committed; `*.md` isn't ignored).
- `mk-tests.ipynb` — notebook that generates the volume fixtures.

The pure-logic checks live in `dev/smoke-test.mjs` (`npm test`); these files
are for eyeballing the real grid in a browser.

## Curated CSV fixtures

### `dates.csv` — date inference, one behavior per column
| column | what it shows |
|--------|---------------|
| `iso` | ISO `yyyy-mm-dd`, incl. leap day `2024-02-29` |
| `us_mdy` | numeric m/d/y; a value with day > 12 pins the column to **US** order |
| `uk_dmy` | a value with first part > 12 pins the column to **UK** day-first |
| `ambiguous` | every value ≤ 12/12 — order is unknowable, defaults to **US m/d/y**, and the column is flagged so the viewer shows the lower-right *"read as US m/d/y (ambiguous)"* note |
| `month_name` | `Jan 5, 2024`, `March 7 2024`, … |
| `two_digit` | 2-digit years pivot at 50 (`99`→1999, `24`→2024, `00`→2000, `76`→1976) |
| `datetime` | ISO + time, rendered `yyyy-mm-dd HH:MM` |
| `with_error` | **the gotcha:** contains `2/30/2020`, `2/29/2021` (non-leap), `4/31/2020`, `13/13/2020` — all invalid. In a file this small the bad cells fail date parsing, so the **whole column falls back to `text`** and the values render raw, left-aligned. (In a file > 2048 rows, a lone bad date *outside* the inference sample would instead keep the column a date and render just that one cell raw.) |

### `numbers.csv` — number formatting matrix
| column | type/format | renders |
|--------|-------------|---------|
| `count` | int | `1,200` (thousands separators) |
| `Year` | year | `1995` (no separators — header *and* 1800–2100 range) |
| `Account No` | plain | `100200` (identifier header → no separators) |
| `Premium` | float 2dp | `1,234.50` (money header → exactly 2dp) |
| `rate` | float 3dp | `0.625` (sensible decimals from magnitude) |
| `span` | eng | `4.5M`, `1.2m` (spans > 6 orders → SI suffixes) |
| `pct` | percent | `12.5%` parses to `0.125` and (header `pct` matches the percent rule, values ≤ 2) renders back as **`12.5%`** — a `%`-suffixed ratio column round-trips |
| `signed` | int | `(2,500)` → `-2,500` (paren negatives) |
| `Zip` | **text** | `07030` kept verbatim — a significant leading zero forces text even for an id-ish header |
| `qty` | int | `NaN`/`NA` are treated as missing and render **blank**; the column stays numeric |

### `giant-ints.csv` — integers beyond 2⁵³ (D1, the "bitten before" case)
JS numbers are IEEE-754 doubles, so an integer above 2⁵³ can't be held
exactly. To avoid silently corrupting the digits, **a column with any such
integer-form value is kept as text** and the digits render verbatim. The
column is right-aligned (it reads as a number) and sorts by magnitude, but
loses the numeric `>`/`..` filters:
- `9007199254740991` (2⁵³−1) — at the safe boundary, so on its own this would
  stay a number; here it shares the column, which is text, so it shows as-is.
- `9007199254740993` (2⁵³+1) — unsafe; forces the column to text.
- `9999999999999999` (sixteen nines) — unsafe.
- `123456789012345678901234567890` (30-digit Python int) — unsafe; renders all
  thirty digits, no rounding.
- `42` — ordinary, but inherits the column's text type.

A float with a big exponent (`1.23e30`) is *not* affected — it's inherently
approximate and stays a number.

### `ratios.csv` — percent format for ratio columns (D2)
| column | type/format | renders |
|--------|-------------|---------|
| `line` | text | category label |
| `premium` | float 2dp | money header → `12,500,000.00` |
| `roe` | percent | `0.121 → 12.1%` (ratio header, values ≤ 2) |
| `loss_ratio` | percent | `0.625 → 62.5%` — snake_case header still matched |
| `combined_ratio` | percent | `1.043 → 104.3%` — values > 1 are fine up to 200% |
| `rate_pp` | float 2dp | **the guardrail:** values are percentage *points* (62.5, 104.0), so `max > 2` fails the gate and the column is **not** re-percented into `6,250%` |

### `quotes.csv` — RFC 4180 strings
Embedded commas, doubled `""` quotes, an embedded newline (a cell spanning
two physical lines), a tab, semicolons/pipes (non-delimiters here), trailing
comma, and Unicode/emoji — all round-trip intact. (`id` types as `plain`
because the header matches the identifier rule.)

### `sample.csv`, `sample-bank.csv`, `sample-bank-uk.csv`
General manual-test data: a headed mixed table (quoted fields, currency,
paren negatives, ISO + US dates, blanks); a **headerless** US bank export
(triggers guessed Date/Description/Amount names); and a headerless **UK**
bank export (BOM + leading blank line + day-first dates).

## Curated markdown fixtures (`md/`)
- `sample-table.md` — headed pipe table with left/center/right alignment and
  an escaped `\|` in a cell.
- `alignment.md` — explicit column alignments plus numeric columns and an
  escaped pipe, for round-tripping through the grid and the Markdown export.
