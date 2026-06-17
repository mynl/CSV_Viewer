# plan-4.0 — display profiles: name rules (A) + inference knobs (A★)

Version target: **4.0.0** (major: first user-facing *policy* surface, but
purely additive — every default is unchanged when no profile is supplied).
Continues the stage lettering: 3.3 was Stage D, so this is **Stage E** in
three parts. E1 is the mechanism; E2 (A) and E3 (A★) are independent and
ride on it. Author handles commits; bump version only when code lands.

**The thesis.** The grid currently bakes the author's (actuarial,
greater_tables) formatting opinions into the code with no escape hatch. A
*profile* — one serializable JSON object, the lingua franca all consumers
(SPA, Python, R) emit into — lets a user override those opinions
declaratively without forking. It is the "config file you'd write if this
were a pure-Python package," made cross-language. 4.0 ships the mechanism
and the two cheapest axes; locale (B) and UI strings (C) are noted at the
end as deliberately deferred.

**Why it's cheap (the speed veto, addressed up front).** Everything resolves
**per-column at load**, nothing lands in the per-cell render hot path: parse
a handful of rules once, test each column name against them once, read a few
constants instead of literals. O(columns × rules) at load, zero per-cell
cost. No new dependency, no bundle growth (E1–E3 touch no `Intl`). The one
perf trap — `Intl` formatter construction — lives entirely in axis B, which
is **not** in this plan.

## Context snapshot (survives a /clear)

- Inference: `inferColumns` in `src/grid/core.js` types each column from a
  stride sample (`INFER_SAMPLE = 2048`), then `classifyNumber` picks the
  number format. Hardcoded constants live here: the D2 percent value gate
  (`max|x| ≤ 2.0`), the eng/SI order-of-magnitude span, integral-float and
  id detection, the 2^53 big-int safety bound (a *correctness* constant —
  see E3, do **not** expose).
- Display: `formatCell` / `formatWithSpec` in `src/grid/util.js` — the format
  mini-language (`[,][.N](f|d|%|e|s)`, plus `year`, `eng`, `pct`). `cellClass`
  emits `col-<type>` + `align-<col.align>` when an explicit align is set.
- Per-column overrides already exist: the `align` string (`'llrcr…'`) and
  `formats`/`fmt` array, addressed **by position**. These are the current —
  and highest-precedence — override layer; the profile sits *below* them.
- Grid opts flow: `CsvGrid(element, data, opts)`; viewer passes opts from
  `app.js`; Python `_OPTION_MAP` (snake→camel) in `python/src/csv_grid/`; R
  `csvgrid()` builds the same opts list. Adding one `profile` opt threads
  through all three unchanged paths.
- Column spec is assembled once after `inferColumns`, before the width solve
  (equal-risk) — the natural seam to insert profile resolution.

---

## E1 — the profile mechanism (cascade + plumbing)

**Goal.** One new opt, `profile` (a JSON object), and a single resolution
step that folds it into the per-column spec. This is the foundation E2/E3
both consume; on its own it's a no-op (empty profile = today's behavior).

- **Schema (the single source of truth — its own doc, the parity contract):**
  ```json
  {
    "inference":    { "maxRatioMagnitude": 2.0, "engSpanOrders": 4 },
    "columnRules":  [ { "match": "...", "type": "...", "format": "...",
                        "align": "...", "label": "..." } ],
    "headerLabels": { "rawName": "Display Name" }
  }
  ```
  (`locale` and `strings` keys are reserved for B/C — see the note — but not
  read in 4.0.)
- **New pure step** `resolveProfile(cols, profile)` (core.js or util.js,
  DOM-free): runs after `inferColumns`, before the width solve. Produces the
  resolved per-column `{type, format, align, label}`. O(cols × rules), once.
- **The cascade (precedence, most-specific wins — document it):**
  1. built-in inference (A★ defaults — today's magic)
  2. `profile.inference` knobs (E3) — re-parameterize step 1
  3. `profile.columnRules` (E2) — name-keyed override
  4. explicit per-column `align[i]` / `formats[i]` — the hard constraint
  Data always wins over a rule's **type** assertion (trust-but-verify, E2);
  the user's explicit per-column array always wins over everything.
- **Emitter threading (parity falls out of the schema):**
  - SPA: `grid.setData(data, { profile })`; viewer accepts it. **Chrome:**
    `?config=<url>` to load a profile by link (fetch JSON, pass through) — the
    only *required* UI change, tiny. A "Load profile…" file picker is OPEN
    (lean: defer to 4.0.x; `?config=` proves the concept).
  - Python: `show(df, profile=<dict>)` **or** `profile="mygrid.toml"` (read +
    parse to dict); convenience kwargs `column_rules=`, `inference=` fold into
    the profile. Existing `align=`/`fmt=` stay highest-precedence.
  - R: `csvgrid(df, profile = <list>)` with the same convenience args. Mirrors
    Python; serializer already round-trips nested lists.

Coding **M** (the resolution seam + three emitter hooks + the schema doc);
startup **~0**.

## E2 — A: column-name rules

**Goal.** Classify/format a column by a pattern on its **name**, complementing
the by-value engine. This is what a user actually knows ("anything ending
`_yr` is a year; `ratio|roe|lr` are percents").

- `columnRules: [{ match, type?, format?, align?, label? }]`, applied in
  `resolveProfile`. **First match wins** (predictable, routing-table style —
  not merge); settled.
- **Matching (the `(?i)` landmine — settled):** **case-insensitive, substring
  (unanchored) by default.** Do **not** support inline flags inside the
  pattern — `(?i)` is valid in Python/PCRE but **throws in JavaScript**, and
  this string crosses all three languages. Anchors (`^…$`) allowed for "exact
  name." **Basic patterns only** (alternation, anchors, char classes — the
  common JS/Python/R subset); documented, since lookbehind / named groups /
  `\p{}` diverge across engines.
- **`format`** reuses the existing mini-language verbatim (`,.2f`, `year`,
  `pct`, `eng`, …) — no new formatter code. **`align`** reuses the align
  chars. **`label`** renames the displayed header (== a `headerLabels` entry)
  **without touching data** — sort/filter/search still key on the real column.
- **`type` is a validated hint, not a command (trust-but-verify — settled):**
  a rule may assert `type:"year"`, but if the data doesn't satisfy it (column
  isn't integral years), the hint is **dropped and inference wins**. The
  geologist's `-3,000,000,000` year stays correct; the client is trumped only
  by the data, and only on *type*. `format`/`align`/`label` are not
  data-gated (they're pure presentation).
- Cost: a few regex tests per column at load. Negligible; no per-cell cost.

Coding **S–M**; startup **~0**.

## E3 — A★: expose the inference knobs

**Goal.** Surface the currently-hardcoded constants of the **by-value** engine
as `profile.inference`, so a user can retune the magic instead of only
overriding it per column.

- Curated, **small** knob set (final list OPEN — pick the user-meaningful
  ones during build):
  - `maxRatioMagnitude` — the D2 percent gate (default `2.0`).
  - `engSpanOrders` — order-of-magnitude span that trips eng/SI format.
  - candidates to weigh: id-detection threshold, integral-float behavior,
    default decimals policy. Keep the list curated — every knob is parity +
    docs surface across three languages.
- **Do NOT expose** the 2^53 big-int safety bound — that's data-integrity
  (D1), not taste; leave it fixed.
- Implementation: `inferColumns`/`classifyNumber` read these from the resolved
  config (with the current literals as defaults) instead of inline constants.
  Read-a-value-not-a-literal — **zero** cost.

Coding **S**; startup **~0**.

---

## Order, deliverables, housekeeping

1. **E1** — mechanism + schema doc + emitter threading (lands first; no-op
   alone).
2. **E2** / **E3** — independent, either order; both pure `core.js`/`util.js`
   resolution.

Each: rebuild `dist/` (`npm run build`, refreshes the python embedded
assets), keep `node dev/smoke-test.mjs` green (add profile-resolution cases:
first-match, type-hint veto, knob override, explicit-array precedence), bump
the three JS version spots to **4.0.0** (+ python `__version__`/`pyproject`
and the R `DESCRIPTION` — all re-emit behavior). Write the **profile schema
doc** (the parity contract), extend each README (SPA / python / R) with a
"Profiles" section + one worked example, update the pinned `human-hints.md`
rules, add a curated `tests/csv/curated/` fixture exercising a rule set, and
a `## 4.0.0` CHANGELOG section at the close.

## Settled vs OPEN

**Settled:** one `profile` opt, JSON, resolved once per column in a pure
`resolveProfile` between inference and the width solve; cascade
inference < knobs < rules < explicit per-column arrays; E2 matching is
case-insensitive substring, **no inline flags** (JS throws on `(?i)`), basic
patterns only, **first match wins**; rule `type` is a data-vetoable hint,
`format`/`align`/`label` are not; E3 exposes a curated knob set but **not**
the 2^53 bound; version 4.0.0.

**OPEN (decide during build):** the final E3 knob list; SPA file-picker for
profiles vs `?config=` only (lean: `?config=` in 4.0, picker later); whether
`headerLabels` and rule `label` are one mechanism or two; `.toml` vs `.json`
as the Python on-disk profile format (lean: accept either via extension).

## Note — axes B and C, deliberately deferred (we thought about it)

Two further axes exist; both are real, both are **out of scope** for 4.0 and
quite possibly forever. Recorded so the design is on the books.

- **B — locale.** A `locale` string (e.g. `"de-DE"`) driving `Intl.NumberFormat`
  / `Intl.DateTimeFormat` for regional separators (`1.234,56`), date order,
  and a default date pattern. Clean conceptual split: **greater_tables owns
  the grammar** (how many decimals, when SI kicks in, year-vs-int, alignment);
  **`Intl` owns the orthography** (which glyph is the thousands/radix
  separator). `Intl` ships in every browser/Node — zero bundle cost. The catch
  and the reason it's its own iteration: `Intl` formatters are **expensive to
  construct**, so they must be built per-column at resolution time and cached
  (never per cell) — that's the lone real perf sensitivity in the whole idea,
  and it deserves dedicated testing. Earns a 4.1 if a user ever asks.

- **C — UI chrome i18n.** A flat `strings: {}` dict translating the app's own
  labels ("Search", "Clear filters", expand tooltips) — independent of both
  the data's language and the locale. Trivial (a lookup table, no hot path),
  foldable in whenever, but low-demand: the data's column names are already
  the user's; only the chrome is English. Reserved key, no committed work.

Both reserve their schema keys (`locale`, `strings`) now so adding them later
is non-breaking. The 4.0 thesis stands on A + A★ alone — the opinion-free,
speed-free axes — which is exactly the cheap way to test whether the profile
concept earns its keep. If it flops, we've risked almost nothing.
