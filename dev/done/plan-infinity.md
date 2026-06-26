# Plan: infinity-aware numbers

Status: **decided, ready to execute.** Target version **3.3.2** (patch —
this is a type-inference bug, not a feature). All four version locations
move together to 3.3.2 (keep them aligned, always). Do this *before* the
3.4 currency work; both touch the same `NUM_RE` / `parseNumber` /
`classifyNumber` trio.

## Bug

A float column containing `np.inf` (e.g. infinite skewness for a BurrIII
severity) infers as **text** and renders left-aligned, even though
`df.dtypes` says `float64`.

### Root cause (verified end to end)

`show()` serializes through `payload()` (JSON), not `to_csv()`. For one
`inf` cell:

1. `payload` float branch (`__init__.py:95`): `pd.isna(np.inf)` is **False**,
   so inf is *not* blanked (NaN *is* — `pd.isna` catches it → `None` →
   blank). It passes through as `float(v)` → `inf`.
2. `_dump` = `json.dumps(..., allow_nan=True)` (default) emits the bare
   literal **`Infinity`** into the `<script>`. JS evaluates that object
   literal (not `JSON.parse`) → the **number `Infinity`**. Correct so far.
3. Grid-side, `normalizeRecords` stringifies every cell: `String(Infinity)`
   → **`"Infinity"`** (verified).
4. Inference: `parseNumber("Infinity")` → **`null`** (the `NUM_RE` gate
   rejects it). A non-blank, non-null-token cell that fails to parse
   **demotes the whole column to `text`** → left-aligned.

So the grid is simply **not infinity-aware**: ±∞ is a legitimate float64
value but no part of the parse/inference path understands it. This is not
Python-specific — loading the `to_csv()` output (literal `inf`) into the app
hits the same wall. **NaN is already handled** (blanked to `null`, never
demotes); inf is the sole offender.

## Fix (JS side — ±∞ is a real numeric value, don't hide it)

Infinite moments are mathematically correct, so treat ±∞ as the value it is:
numeric, right-aligned, sortable. Three small edits in `src/grid/`, plus one
guard.

1. **`core.js` — `NUM_RE` + `parseNumber` (`:133`, `:154`):** recognize
   `inf`, `infinity`, `∞` (case-insensitive), with optional leading sign and
   accounting parens, → `{v: ±Infinity, dec: 0}`. Accepting both the
   `Infinity` spelling (Python payload, via `String()`) and `inf` (CSV)
   covers both entry paths.
2. **`core.js` — `classifyNumber` (`:321`):** compute the magnitude stats
   (`maxAbs`, `minAbs`, `sum`, `nNz`) over **finite** values only
   (`Number.isFinite`). Necessary: today `[0.78, 0.76, Infinity]` classifies
   as **`eng`** (verified) because the `maxAbs/minAbs > 1e6` span test sees
   `maxAbs = Infinity`. With finite-only stats the column classifies on its
   real magnitudes; the inf cell just displays as ∞. (`allInt` already
   excludes inf: `Number.isInteger(Infinity)` is `false`.) Degenerate
   all-infinite column → `nNz === 0` → existing `float` fallback. Fine.
3. **`util.js` — `formatCell` display:** **DECIDED — render literal
   `inf` / `-inf`** (the `∞` glyph is too small / looks poor). Note
   `Intl.NumberFormat` defaults to `∞`, so this needs an **explicit branch**:
   early in the `number` branch, `if (!Number.isFinite(v)) return v > 0 ?
   'inf' : '-inf';` — placed so it wins for *every* format (float, money,
   pct, eng, year/plain), since `±∞` reads the same regardless.
4. **`core.js` — `engFormat` (`:371`) guard:** `engFormat(Infinity)`
   currently yields `"InfinityT"`. After fix #2 the auto path won't route an
   inf column to `eng`, but a user can still force an `eng`/`s` spec on one,
   so add `if (!Number.isFinite(v)) return v > 0 ? 'inf' : '-inf';` (also
   covers the `s` spec via `formatWithSpec`). With fix #3 the auto display
   path already short-circuits before `engFormat`; this guard is the
   belt-and-braces for an explicit spec.

### Falls out for free
- **Sort/filter:** `col.values` holds `±Infinity`, which orders correctly
  (`>`, `<`, ranges all work).
- **Width solver:** measures rendered cells, so `∞` is accounted for.
- **`isUnsafeBigInt`:** inf tokens aren't integer-form → returns `false`,
  unchanged.
- **`raw` display mode:** verbatim source, untouched.

### Not the fix
Blanking inf in `payload` (Python) — rejected: it discards a meaningful
value. The fix belongs in the grid's inference, which also repairs the
CSV-load path.

## Confidence

The **diagnosis is empirically verified** (every step above run against the
real `core.js`/`util.js`: `String(Infinity)="Infinity"`, `parseNumber`
returns `null` on all inf spellings today, `Intl` gives `∞`, the column
classifies as `eng`). The **fix is straightforward** and local, but not yet
implemented or smoke-tested — I'll validate with `node dev/smoke-test.mjs`
plus a regenerated Python fixture before calling it done. No expected
surprises; the display taste call (literal `inf`) is settled.

## Test / housekeeping

- `dev/smoke-test.mjs`: add cases — `parseNumber` accepts `inf`/`Infinity`/
  `-inf`/`∞` → `±Infinity`; a float column with an inf infers as `number`
  (right-aligned), not text, and does **not** classify as `eng`; display
  renders `inf`/`-inf`; sort/filter order inf correctly.
- `npm run build` (refreshes `dist/` + the Python package's embedded
  bundle — committed, no auto-update); re-run the smoke test.
- `uv run --project python dev/make-embed-test-python.py` (regenerate
  fixtures; the inf-bearing case now renders numeric).
- **Versions — align ALL FOUR on 3.3.2** (current skew: app trio at 3.3.0,
  python at 3.3.1; this realigns them and they stay aligned thereafter):
  - `VERSION` (`app.js:19`), `sw.js` cache, `package.json` → **3.3.2**
  - python `__version__` + `pyproject.toml` → **3.3.2**
- `CHANGELOG.md` + `human-hints.md`.

## Decisions (settled)

- Display non-finite as literal **`inf` / `-inf`** (not the `∞` glyph).
- All four version locations aligned on **3.3.2** and kept aligned going
  forward.
