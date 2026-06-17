---
title: "csv-viewer — worked examples (Python)"
subtitle: "The formatting algorithm, exercised through the csv_grid emitter"
---

# Worked examples

Runnable companions to [formatting-algorithm.md](formatting-algorithm.md).
Each example drives the grid through the Python emitter (`csv_grid`) and
states what the grid does and why, with a link back to the rule. The grid
re-infers types from the emitted values exactly as the viewer app does, so
these examples show the *same* engine the SPA and R wrapper use.

## Setup

```bash
uv add csv-grid        # or: pip install csv-grid
```

```python
import pandas as pd
from csv_grid import show, to_html

# show(df)        → display in a Jupyter / Quarto cell
# to_html(df)     → return a self-contained HTML fragment (static sites)
```

`show(df, **options)` renders inline; `to_html` returns a fragment. Options
mirror the JS grid in snake_case (`align`, `fmt`/`formats`, `width_mode`,
`display_mode`, `theme`, …). Below, "→" means "the grid displays".

## Options reference

The full keyword list for `show()` / `to_html()` (from their docstrings;
both take the same options):

| Option | Type / values | Default | Effect |
|---|---|---|---|
| `name` | str | — | label shown in the grid's status line |
| `assets` | `'inline'` \| base-URL str \| `False` | `'inline'` | `'inline'` embeds CSS+JS (injected once into `<head>` by an idempotent guard); a base URL links them; `False` emits nothing (assets already present) |
| `index` | bool | `False` | include the DataFrame index as leading column(s) |
| `theme` | `'auto'` \| `'light'` \| `'dark'` | `'auto'` | `'auto'` follows host page / OS (`prefers-color-scheme`); the others force the color scheme |
| `global_search` | bool | `True` | fzf search box |
| `column_filters` | bool | `True` | per-column filter row |
| `sortable` | bool | `True` | click headers to sort |
| `status_bar` | bool | `True` | row-counts line |
| `expand_buttons` | bool | `True` | Expand / Contract pair |
| `align` | str `'llrcr…'` (l/r/c per column) | — | overrides the type-based alignment |
| `formats` / `fmt` | list (per column; `None` = auto) | — | format spec `[,][.N](f\|d\|%\|e\|s)` plus `'year'`/`'eng'` |
| `width_mode` | `'equal-risk'` \| `'coverage'` | `'equal-risk'` | squeeze allocation when wider than the container (see [column-width.md](column-width.md)) |
| `display_mode` | `'auto'` \| `'raw'` | `'auto'` | `'auto'` = type-aware formatting; `'raw'` = verbatim source (type still drives alignment/sort) |
| `rows` | int | — | cap the scroll viewport to ~N rows (vertical scroll for the rest) |
| `max_height` | str (CSS, e.g. `'400px'`) | — | raw max-height; overrides `rows` when set |
| `render_cap` | int | `2048` | rows rendered before "show all" |
| `eager_cells` | int | `262144` | below this many cells, format everything up front (else lazy) |
| `worker` | bool | `False` | parse worker (off here — data is inlined, not fetched) |

---

## The number formatting matrix

One frame, one column per behavior — the Python mirror of
`tests/csv/curated/numbers.csv`. Each column is classified independently by
[`classifyNumber`](formatting-algorithm.md#5-choosing-a-number-format-classifynumber-corejs321).

```python
df = pd.DataFrame({
    "count":      [1200, 87, 9_500, 42, 360_000],     # int   → 1,200
    "Year":       [1995, 2005, 2020, 2024, 2024],     # year  → 1995 (no commas)
    "Account No": [100200, 100201, 100202, 100203, 100204],  # plain → 100200
    "Premium":    [1234.5, 87.0, 9500.25, 42.1, 360000.0],   # money → 1,234.50
    "score":      [0.625, 0.481, 0.713, 1.05, 0.98],  # float → 0.625 (mag-based dp)
    "span":       [4.5e6, 1.2e-3, 8.0e3, 3.3e-1, 9.9e9],     # eng → 4.5M, 1.2m
})
show(df, name="number matrix")
```

What the grid does, column by column (all right-aligned):

- `count` → `1,200` — plain integers get thousands separators
  ([Integers](formatting-algorithm.md#integers)).
- `Year` → `1995` — year-ish header **and** 1800–2100 range, no commas.
- `Account No` → `100200` — identifier header (note the **space**: the id/
  money/year rules use `\b`, which an underscore defeats), no commas.
- `Premium` → `1,234.50` — money header forces exactly 2dp.
- `score` → `0.625` — no matched header word, so float decimals from
  magnitude (`score` is deliberately not `rate`, which *is* a percent word).
- `span` → `4.5M`, `1.2m` — spans > 6 orders → engineering/SI.

### Years

Year format triggers two ways — header **or** value range
([rule](formatting-algorithm.md#years-vs-integers)):

```python
df = pd.DataFrame({
    "vintage": [2018, 2019, 2020, 2021, 2022],   # year word → 2018 (no commas)
    "Proj Yr": [2050, 2100, 2150, 2200, 2250],   # year word forces year even past 2100 → 2150
    "qty":     [2018, 9, 4000, 7, 33],           # no year word, not all in range → int (2,018)
})
show(df)
```

`vintage` → plain `2018` (header word). `Proj Yr` → `2150` (no commas):
the header word forces year format **even though** `2150`+ is outside the
1800–2100 range — without the header those values would make it a plain
`int` (`2,150`). `qty` → `2,018`, `4,000`: no year-ish header and not every
value is in range, so it stays an `int`. (Note `Proj Yr` uses a space —
`\byr\b` won't match inside `proj_yr`.) **The data-wins guard:** a
geologist's `-3000000000` fails the range test and is *not* forced to year
format unless the header says so.

### Identifiers

Identifier headers suppress separators — unless the header is *also* a
money word ([rule](formatting-algorithm.md#identifiers-plain-integers)):

```python
df = pd.DataFrame({
    "Policy No":       [100200, 100201, 100202],   # plain → 100200
    "Claim ID":        [55_001, 55_002, 55_003],   # plain → 55001
    "Account Balance": [100200, 7, 9_500],          # id + money overlap → MONEY wins → 100,200.00
})
show(df)
```

Use **spaces** in these headers: the id/money/year rules match on `\b`
boundaries, which an underscore (a word character) defeats — `policy_no`
would *not* match the id rule and would render `100,200` with separators.
`Account Balance` matches both the id rule and the money rule; money wins
the overlap by design, so it renders 2dp with separators.

### Integers

Plain integers get thousands separators; parenthesized values are negative
([`parseNumber`](formatting-algorithm.md#4-parsing-a-number-parsenumber-corejs154)):

```python
df = pd.DataFrame({"signed": [2500, -1200, 0, 7_800, -42]})
show(df)   # → 2,500   -1,200   0   7,800   -42
```

(In CSV form, `(2,500)` parses to `-2500` and renders `-2,500`.)

### Floats

When no money/percent/eng rule fires, decimals are uniform across the
column at ~4 significant digits at the typical magnitude, capped by the
precision the data carried
([rule](formatting-algorithm.md#floats-and-the-decimals-rule)):

```python
df = pd.DataFrame({
    "tiny":  [0.001234, 0.005678, 0.000912, 0.004321],   # >2 dp → magnitude rule → 6dp
    "mid":   [12.3456, 87.6543, 9.5012, 142.1234],       # >2 dp, larger mag → fewer dp (2dp)
    "money": [1234.5, 8760.0, 950.2, 14210.9],           # ≤2 dp & < 1e5 → money-by-value → 2dp
})
show(df)
```

- `tiny` → `0.001234` — six decimals: the magnitude rule gives ~4
  significant digits at this scale, capped by the precision the data
  carried.
- `mid` → `12.35` — same rule, larger magnitude → fewer decimals.
- `money` → `1,234.50` — trips **money-by-value** (≤ 2 observed decimals and
  max < 100,000), so it gets 2dp even with no money header. (`tiny`/`mid`
  carry more than 2 decimals, so they skip this rule.)

### Engineering format

A float column spanning more than 6 orders of magnitude switches to SI
suffixes ([rule](formatting-algorithm.md#engineering-format)):

```python
df = pd.DataFrame({"flow": [1.2e-3, 4.5e6, 8.0e3, 9.9e9, 3.3e-1]})
show(df)   # → 1.2m, 4.5M, 8k, 9.9G, 330m
```

(Auto `eng` is 3 significant figures with trailing zeros dropped, so `8000`
→ `8k`. To force fixed decimals, use the `.Ns` spec below.)

To force SI on a column that *doesn't* auto-trigger, name the spec — see
[the mini-language](#the-format-mini-language).

### Missing values

The null-token set renders blank and never demotes the column
([rule](formatting-algorithm.md#null-tokens-null_tokens-corejs146)). From
pandas, `NaN`/`None`/`NaT` become blanks automatically:

```python
df = pd.DataFrame({
    "amount": [1200, "NA", 950, "n/a", 480],         # numeric col; NA/n/a → blank, column stays numeric
    "qty":    [100, None, 300, float("nan"), 500],   # pandas None/NaN → blank
})
show(df)
```

`amount` is an object column whose non-token cells all parse as numbers, so
the grid types it **numeric**; the `NA`/`n/a` cells are recognized tokens
and render **blank** (the column keeps its numeric type, right alignment,
and value sort). `qty` → `100`, blank, `300`, blank, `500` — pandas
`None`/`NaN` arrive as blanks the same way.

Note the asymmetry: a null token only blanks inside a **numeric or date**
column (where it's a hole in typed data). In a plain **text** column the
same string renders verbatim — `"NA"` in a column of category labels stays
`"NA"`.

---

## Percents (the ratio rule)

A **float** column with a ratio-ish header **and** max\|x\| ≤ 2 is shown as
a percentage. The value gate — not the name — is the real guard
([rule](formatting-algorithm.md#percents-the-ratio-rule)). Mirrors
`tests/csv/curated/ratios.csv`:

```python
df = pd.DataFrame({
    "line":           ["GL", "Property", "WC", "Auto"],
    "premium":        [12_500_000.0, 8_200_000.0, 15_750_000.0, 3_100_000.0],
    "roe":            [0.121, 0.095, 0.142, 0.088],   # → 12.1%
    "loss_ratio":     [0.625, 0.481, 0.713, 0.905],   # snake_case still matches → 62.5%
    "combined_ratio": [1.043, 0.962, 1.121, 0.998],   # values > 1 fine up to 200% → 104.3%
    "rate_pp":        [62.5, 48.1, 71.3, 104.0],      # percentage POINTS: max > 2 → NOT re-percented
})
show(df, name="ratios")
```

- `premium` → `12,500,000.00` (money header, 2dp).
- `roe`, `loss_ratio` → `12.1%`, `62.5%` — fraction × 100, decimals from
  the data (`clamp(maxDec−2, 1, 4)`).
- `combined_ratio` → `104.3%` — values above 1 are fine; the gate is ≤ 2
  (200%), not ≤ 1.
- `rate_pp` → `62.50`, `104.00` — **the guardrail:** these are already in
  points, so `max > 2` fails the gate and the column stays a 2dp float
  rather than becoming `6,250%`.

---

## Date inference

Dates parse liberally and display ISO, center-aligned. Order (US vs UK) is
decided **per column** ([rule](formatting-algorithm.md#6-parsing-a-date-parsedate-corejs214)).
With pandas datetimes the order is unambiguous; the interesting cases come
from string columns (as a CSV would carry them):

```python
df = pd.DataFrame({
    "iso":        ["2024-01-05", "2024-02-29", "2023-12-31"],   # ISO, incl. leap day
    "us_mdy":     ["01/05/2024", "12/31/2023", "07/04/2024"],   # a >12 second part pins US
    "uk_dmy":     ["13/05/2024", "31/12/2023", "05/01/2024"],   # a >12 first part pins UK
    "ambiguous":  ["05/01/2024", "03/07/2024", "08/09/2024"],   # all ≤12/12 → US default + note
    "month_name": ["Jan 5, 2024", "March 7 2024", "5 Jan 2024"],
    "two_digit":  ["01/05/99", "01/05/24", "01/05/00"],         # pivot at 50: 1999, 2024, 2000
})
show(df, name="dates")
```

All render `2024-01-05`-style ISO. `uk_dmy` re-parses the whole column
day-first because `13/05/2024` can only be day-first. `ambiguous` defaults
to US m/d/y and the viewer footnotes it "(ambiguous)". An *invalid* date in
a small column (e.g. `2/30/2020`) fails parsing and falls the whole column
back to `text` (rendered raw, left-aligned).

If your data is already `datetime64`, the emitter sends ISO strings (with
`HH:MM` only when a column has non-midnight times), so no ambiguity arises:

```python
df = pd.DataFrame({"written": pd.to_datetime(
    ["1995-03-15", "2005-07-01 14:30", "2020-01-31"])})
show(df)   # mixed times → "1995-03-15 00:00", "2005-07-01 14:30", …
```

---

## Big integers beyond 2⁵³

Integers past `Number.MAX_SAFE_INTEGER` would corrupt as float64, so the
column is kept **text** and the digits render verbatim
([rule](formatting-algorithm.md#big-integers-past-2-isunsafebigint-corejs185)).
Mirrors `tests/csv/curated/giant-ints.csv`:

```python
df = pd.DataFrame({"big_id": [
    "9007199254740991",                 # 2^53 - 1, the safe boundary
    "9007199254740993",                 # 2^53 + 1, unsafe → forces the column to text
    "9999999999999999",                 # sixteen nines, unsafe
    "123456789012345678901234567890",   # 30-digit int, all digits survive
    "42",                               # ordinary, inherits the column's text type
]})
show(df)
```

Pass these as **strings** (object dtype) — a Python `int` this large is
fine in pandas, but the point is the grid never rounds them. The column is
right-aligned (it reads as numeric) and sorts by magnitude, but loses the
numeric `>`/`..` filters. A float with a big exponent (`1.23e30`) is *not*
affected — it's inherently approximate and stays a number.

---

## RFC 4180 strings

The parser handles embedded commas, doubled `""` quotes, embedded newlines,
tabs, and Unicode/emoji
([rule](formatting-algorithm.md#rfc-4180-parse-parsecsv-corejs53)). Through
the Python emitter you just pass the strings; round-tripping is automatic:

```python
df = pd.DataFrame({
    "id":   ["A-1", "A-2", "A-3"],                       # id header → plain text
    "note": ['has, comma', 'said "hi"', "two\nlines"],   # all survive intact
})
show(df)
```

`id` types as text (identifier header); `note` keeps its commas, quotes,
and the embedded newline (collapsed to a space only on Markdown export).

---

## Headerless bank exports

When the first row is data (any cell parses as a number/date), the grid
treats the file as headerless and synthesizes type-named headers
([rule](formatting-algorithm.md#2-header-detection-looksheaderless-corejs274)).
This is a *file ingest* behavior; from pandas you always have headers, but
you can see the same naming by loading a headerless CSV in the app
(`?src=tests/csv/curated/sample-bank.csv`) — columns become
`Date / Description / Amount`. The Python emitter mirror is simply: give
your frame meaningful column names and the type rules do the rest.

---

## Overriding the magic

You rarely need to fork source — three option layers sit above inference
([precedence](formatting-algorithm.md#overriding-the-magic)).

**Per-column alignment** (`align`, one char per column, l/r/c; other chars
keep the type default):

```python
show(df, align="l--c")   # col 1 left, 2 & 3 keep default, 4 centered
```

**Raw display lens** (`display_mode='raw'`) — verbatim source, no
formatting; type still drives alignment and sort:

```python
show(df, display_mode="raw")
```

### The format mini-language

`fmt` (alias `formats`) is a per-column list; `None` keeps auto. Spec =
`[,][.N](f|d|%|e|s)` plus named `'year'`/`'eng'`
([reference](formatting-algorithm.md#8-the-format-mini-language-parseformatspec-utiljs33-formatwithspec-utiljs46)):

```python
df = pd.DataFrame({
    "line":    ["GL", "Property", "WC"],
    "premium": [12_500_000.0, 8_200_000.0, 15_750_000.0],
    "ratio":   [0.625, 0.481, 0.713],
    "size":    [4.5e6, 1.2e3, 8.0e9],
})
show(df, fmt=[None, ",.0f", ".1%", ".2s"])
```

- `line` → auto (text).
- `premium` → `12,500,000` — comma-grouped, 0 decimals (override the money
  2dp default).
- `ratio` → `62.5%` — force percent with 1 decimal.
- `size` → `4.50M`, `1.20k`, `8.00G` — force SI to 2 decimals even though
  the column wouldn't auto-trigger eng.

Other spec examples: `'year'` (plain integer year), `',d'` (rounded integer
with commas), `'.3e'` (scientific, 3dp), `'.4f'` (fixed 4dp).

---

## Width modes

When the table is wider than its container, `width_mode` picks the squeeze
([rule](formatting-algorithm.md#10-column-widths-solvewidths-utiljs258)):

```python
show(df, width_mode="equal-risk")   # default: every column truncates with equal probability (VaR)
show(df, width_mode="coverage")     # maximize the count of cells shown in full
```

`equal-risk` spreads the pain uniformly (the Value-at-Risk allocation);
`coverage` completes cheap narrow columns to 100% and concentrates
truncation on a few wide-outlier columns. Both are no-ops when the table
fits; both fall back to floors + horizontal scroll when nothing fits.
