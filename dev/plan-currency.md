# Plan: currency-aware numbers

Status: **decided, ready to execute** (after the 3.3.2 infinity fix lands).
Target version **3.4.0**, all four version locations aligned (and kept
aligned). All decisions locked 2026-06-18. Nothing below is built yet.

## Decisions

1. **Battery = `$ £ € ¥`** (USD, GBP, EUR, and ¥ which covers *both*
   Japanese yen and Chinese renminbi/yuan — they share the glyph). Also
   accept the full-width CJK variant `￥` (U+FFE5). Multi-char prefixes and
   ISO codes remain out of scope.
2. **Negatives → `-$100.00`** (sign, symbol, digits). Both `($100)` and
   `-$100` normalize to this.
3. **Mixed-currency → per-cell symbols** (option (i) below): a `Uint8Array`
   symbol table on the column, allocated only when a column mixes symbols.
4. **Bare cell in a uniform-currency column → STAY BARE.** A cell with no
   symbol (`100` in an otherwise-`$` column) renders `100.00`, no symbol —
   the grid never *adds* a currency symbol, only preserves one that was
   there. (So a symbol on display always reflects a symbol in the source.)

## Problem (three issues, from review of the formatting algo)

Today the currency symbol is a *parse hint that gets discarded*: `NUM_RE`
and `parseNumber` (`core.js:133`, `:154`) recognize a single leading `$`,
strip it, and the grid re-emits a bare number. Concretely:

1. **Only `$` is recognized.** `£100`, `€100`, `¥100` (and any non-dollar
   glyph) fail `parseNumber` → if the whole column is non-dollar it infers
   as **text** (left-aligned, no numeric sort), and a *mixed* `$`/`£`
   column demotes to text too.
2. **`-$100` is broken.** `NUM_RE` orders the prefixes `(` `$` `-`, so the
   sign must follow the symbol. `$-100` and `($100)` parse; `-$100` →
   `null`. Verified. This is a plain bug.
3. **Currency information is lost on display.** Even for clean `$` data the
   symbol never returns; whether you get money 2dp depends entirely on the
   *header* matching `MONEY_TITLE_RE`, not on the symbol that was sitting on
   the values.

## Proposed behavior (the author's call, restated)

A value carrying a currency symbol is **a number, and money (2dp), and we
keep the symbol on display.** Parens/sign forms normalize to one canonical
output.

- **Recognize a battery of symbols**, all behaving like `$`.
- **Any currency symbol on a column's values ⇒ money**: format = float,
  `dec = 2`, regardless of header (a new *value-based* money trigger,
  alongside the existing header trigger).
- **Retain the symbol on display**: `$1,234.50`, `£1,200.00`, prepended
  after the sign.
- **Normalize negatives** so `($100)` and `-$100` render identically.
- Numeric **sort and alignment unchanged** (right-aligned, sort by
  `col.values` — the symbol is display-only). Mixed-currency columns sort
  by raw magnitude with **no FX conversion** (out of scope; documented).

### Symbol battery (locked)

`CUR_RE = [$£€¥￥]` — four currencies, five code points (¥ U+00A5 plus the
full-width ￥ U+FFE5). `¥` serves yen and yuan alike; no disambiguation.
Multi-char prefixes / ISO codes stay out of scope.

### Negative normalization (locked)

Both `($100)` and `-$100` render `-$100.00` — sign, then symbol, then
grouped digits. Consistent with the grid already showing all parenthesized
negatives as a minus (`(123)` → `-123.00` via `Intl`). Accounting parens
were considered and declined (they'd be a grid-wide convention change).

## Design / where it cuts

All logic stays pure and DOM-free; touch points:

**`core.js`**
- `CUR_RE` — new character class for the battery.
- `NUM_RE` (`:133`) — admit an optional symbol and an optional leading
  sign **in either order**, plus the existing accounting parens. Fixes
  `-$100` as a side effect.
- `parseNumber` (`:154`) — return `{v, dec, sym}`. New order: strip parens
  (→ neg), capture+strip the currency glyph wherever it sits, strip `%`,
  resolve the sign, strip commas, `parseFloat`. `sym = ''` when none.
- `isUnsafeBigInt` (`:185`) — extend the `[$,]` strip to the battery so a
  big-int `£900719…` is still caught.
- `inferColumns` (`:439`) — in the value-build loop, collect the distinct
  symbols seen. Set `col.currency` (the symbol string) for a uniform
  column; for the mixed case see the decision below. Pass a `hasCurrency`
  flag to `classifyNumber`.
- `classifyNumber` (`:321`) — treat `hasCurrency` like a `MONEY_TITLE_RE`
  hit: force `{format:'float', dec:2}`, ranked **above** year/int/percent
  (a `$` value is money even if the header says "year"). The *symbol*
  itself lives on the column, not in the format enum — `classifyNumber`
  only needs the boolean.

**`util.js`**
- `formatCell` (`:90`) — number branch, default money path only (i.e. **not**
  when an explicit `col.fmt` is set, and not for `year`/`plain`/`eng`/`pct`):
  build the grouped 2dp string, then insert the cell's symbol after a
  leading `-`. Explicit `fmt` spec ⇒ **full control, symbol suppressed**
  (the mini-language has no currency; documented).
- Width solver: no change — widths are measured from rendered cells, so the
  extra glyph is accounted for automatically.

**No change** to sort (`col.values`), `raw` display mode (already verbatim,
so the original symbol survives untouched), or the export `raw` path
(`grid.js:411`, uses `this.rows`). Export `formatted` will now include the
canonical symbol+2dp (CSV quotes it because of the comma, as it already does
for grouped money — fine).

### Mixed-currency columns (locked: per-cell symbols)

Uniform-currency columns are the 99% case. For a column mixing ≥2 distinct
symbols, store a `col.symbols` index array (a `Uint8Array` into a tiny
symbol table) **only** when mixed; `formatCell` prepends the cell's own
symbol. Cost: 1 byte/row for that one column (≈250 KB at 250k rows),
allocated only when needed. No information lost. A bare cell renders with
no symbol — in a mixed *or* uniform column (decision #4: the grid never adds
a symbol, only preserves one from the source).

## Cost / scope (the honest YELL)

Moderate, mostly localized. Runtime cost negligible: `parseNumber` gains a
symbol capture, `inferColumns` gains a symbol scan + (only when mixed) one
`Uint8Array`, `formatCell` gains a string prepend on money cells. Code grows
~40–60 lines plus doc. Bigger than a one-liner, well short of a rework — and
it changes a *default* (currency now shows), so it's a version-bump feature,
not tidying. The accounting-parens alternative, if chosen, is a wider,
grid-global change — call that out separately before building.

## Out of scope (explicit)

FX conversion / cross-currency sort; multi-char symbols and ISO codes
(`USD`, `kr`, `R$`); a currency *format-spec* char (e.g. `$,.2f`) — possible
follow-on once the auto path lands; locale-specific grouping/radix (output
stays `en-US`).

## Test / housekeeping checklist

- `dev/smoke-test.mjs`: add cases — each battery glyph parses; `-$100`,
  `$-100`, `($100)` all → −100 with `sym='$'`; value-based money trigger
  forces 2dp on a non-money header; uniform vs mixed display; explicit `fmt`
  suppresses the symbol; `raw` mode preserves the source verbatim.
- `npm run build` (dist + python embedded assets are committed, don't
  auto-update); re-run smoke test.
- `uv run --project python dev/make-embed-test-python.py` (emitter output
  changes once currency shows).
- **Versions — align ALL FOUR on 3.4.0** (they'll be at 3.3.2 from the
  infinity fix): `VERSION` (`app.js:19`), `sw.js` cache, `package.json`,
  and python `__version__` + `pyproject.toml`, all → **3.4.0**.
- Docs: update `docs/formatting-algorithm.md` §4 (parse), §5 (the new
  value-based money trigger + symbol retention), §7 (display), and the
  `MONEY_TITLE_RE` note (header `$£€` vs the now-wider value battery);
  `CHANGELOG.md`; `human-hints.md`.

## Open questions

None — all four decisions locked.
