# plan 3.8.0 — adaptive (finest-present) date/time precision + explicit date format

## Goal

Date columns currently display `YYYY-MM-DD`, or `YYYY-MM-DD HH:MM` when any
source value carried a time token — seconds are parsed then discarded, and a
column of all-midnight timestamps still shows a dangling ` 00:00`. Two fixes:

1. **Finest-present auto precision.** A date column shows exactly the
   resolution its data carries — down to milliseconds — and no finer. Built
   for log displays where a burst within a minute needs seconds, and a burst
   within a second needs fractions.
2. **Explicit per-column date format always outranks** the auto rule (a
   strftime-style token in `fmt`/`formats`).

## The display rule (auto, finest-present)

Decided **once per column** during the all-rows date pass in `inferColumns`
(the same loop that computes `hasTime` today — no extra pass). Fold over every
parsed timestamp `t` (ms since epoch, local) and track:

- `anySubDay` — any `t` with a nonzero time-of-day (`t % 86400000 !== 0`)
- `anySubMin` — any `t` with nonzero seconds-or-finer (`t % 60000 !== 0`)
- `fracDigits` — max fractional resolution present, in {0,1,2,3}:
  for `ms = t % 1000`: `0` if `ms===0`, else `1` if `ms%100===0`,
  else `2` if `ms%10===0`, else `3`. Take the column-wide max.

Collapse to one precision level + uniform fractional width `F`:

| condition                          | level    | display                         |
|------------------------------------|----------|---------------------------------|
| `!anySubDay`                       | day      | `YYYY-MM-DD`                    |
| `anySubDay && !anySubMin`          | minute   | `YYYY-MM-DD HH:MM`             |
| `anySubMin`, `F = fracDigits`      | second   | `YYYY-MM-DD HH:MM:SS[.f…]`     |

`F` is uniform per column, by direct analogy to the number columns' uniform
per-column decimals (max decimals present): `F=0` → plain `:SS`; `F>0` →
`:SS.` + the first `F` digits of the zero-padded-to-3 ms. Pads within a column
(a `.5` in an `F=3` column reads `.500`), and `F` rises to 3 only when some
value in the column carries true thousandths. (Simpler alternative if
preferred: always show full 3-digit ms whenever sub-second is present —
`F` fixed at 3. Recommend the finest-present width for consistency with the
number rule; trivially swappable.)

**Midnight fix falls out for free:** an all-`00:00:00` column has
`anySubDay === false` → level `day` → no trailing time.

## Explicit date format (outranks auto)

`fmt` / `formats` is positional today and `parseFormatSpec` rejects anything
that isn't a number spec / `year` / `eng`. Extend it:

- A spec **containing `%`** on a **date** column → `{ kind: 'datefmt', pattern }`.
- `formatCell`'s date branch: if `col.fmt?.kind === 'datefmt'`, render via a
  small strftime instead of the auto level; else use the auto level above.

strftime subset (documented, literals pass through; `%%` → `%`):
`%Y %y %m %d %H %M %S %f`. `%f` here = 3-digit **milliseconds** (we cap at ms),
not Python's 6-digit microseconds — document the divergence in the README and
the spec comment. (Decision: reuse `%f`, do not invent `%L`.)

A number spec on a date column (or vice-versa) stays an error.

## Data-model change (the one real plumbing edit)

- `ISO_RE` (`core.js:143`): capture the fraction — `(?::(\d{2})(?:\.(\d+))?)?`.
- `parseDate` (`core.js:243`): pass the captured fraction through; convert to
  ms (`Math.round(+('0.'+frac) * 1000)`), clamp/truncate to 3 digits of
  resolution since storage is `Date` (ms).
- `makeDate` (`core.js:228`): accept `ms`, `new Date(y,mo-1,d,h,mi,se,ms)`.
- Non-ISO date forms (numeric triples, month-name) carry no sub-second — ms 0.

Storage stays a JS `Date` timestamp; ms is the floor. No sub-ms (µs/ns log
stamps round — accepted).

## Per-column shape

`inferColumns` date return gains a precision descriptor, e.g.
`timePrec: { level: 'day'|'minute'|'second', frac: 0..3 }`, replacing the role
of the bare `hasTime` flag in `formatCell` (keep `hasTime` if anything else
reads it — check). Rides through the worker automatically (it's part of the
column object already serialized).

## Files touched

| file | change |
|---|---|
| `src/grid/core.js` | `ISO_RE` fraction capture; `makeDate` ms; `parseDate` fraction→ms; `inferColumns` date loop computes `timePrec` |
| `src/grid/util.js` | `formatCell` date branch uses `timePrec` / `datefmt`; `parseFormatSpec` recognizes `%`-specs; small `strftime` helper |
| `src/grid/grid.js` | none expected (already applies `formats` per column) — verify |
| `src/grid/worker.js` | none expected — verify the new field survives serialization |
| `python/src/csv_grid/__init__.py` | `payload` must emit **full** precision (today it emits `%H:%M` and drops seconds) so the grid can detect resolution; update docstring re date `fmt` now allowed |
| `python/README.md` | document date format tokens + finest-present behavior |
| `dist/` | `npm run build` after `src/grid/` changes |
| version | `VERSION` (`app.js:19`), `CACHE` (`sw.js:7`), `package.json`; python `__version__` + `pyproject.toml` (python changes) → **3.8.0** |
| `CHANGELOG.md`, `human-hints.md` | as usual at close |

## Python emitter detail

`payload` (`__init__.py:94-97`) currently picks `%Y-%m-%d` or `%Y-%m-%d %H:%M`
— it drops seconds, and owns its own midnight check. Replace with a single
**full-precision** emit: always `%Y-%m-%d %H:%M:%S`, plus `.fff` when any
sub-second is present. **The grid owns the collapse uniformly** — so the
Python side no longer special-cases all-midnight; it emits `00:00:00` and the
grid's finest-present rule reduces it to date-only. This deletes the
`midnight`/`fmt` branch in `payload` (simpler, not just changed).

## Tests (`dev/smoke-test.mjs`)

- A column with `.5` / `.25` / `.125` → `F=3`, all render 3 dp uniform.
- A column with only whole seconds → `:SS`, no fraction.
- A column of `…T00:00:00` → date-only (midnight regression).
- Burst within a second (distinct ms) → ms shown.
- Explicit `%H:%M:%S` on a date column overrides auto.
- Python payload round-trip: sub-second survives to the grid.

## Decisions (settled)

1. **`%f` = milliseconds** (3 digits); reuse the token, document the
   divergence from Python's microsecond `%f`.
2. **The grid owns the all-midnight collapse** uniformly; the Python `payload`
   just emits full precision (its midnight branch is removed).
3. **Version 3.8.0** (a clean minor bump — not a 3.7.x patch).

## One open point

Fractional width: finest-present per column (`F`∈{0..3}, recommended) vs.
fixed 3-digit ms whenever sub-second is present. Trivially swappable; plan
assumes finest-present.
