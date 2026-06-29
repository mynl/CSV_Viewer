# plan 3.6 — self-calibrating filter debounce

> **REVERTED in 3.6.2 (2026-06-29).** Shipped in 3.6.0, then backed out: it
> made large files worse, not better. The window was measured from
> `performance.now()` around `refresh()`, which excludes layout/paint — the
> dominant cost on a big table — so it never coalesced and merely relocated the
> heavy render onto a timer (which then contended with the global-search index
> build). A trailing debounce can't make a render cheap. Superseded by
> `dev/plan-3.7-windowed-render.md`. Kept here as the record of what was tried.

## Problem

On large files, global fzf search and per-column filters feel sluggish
**while typing/backspacing** — even though a single pasted query reacts
fast. Today there is **no debounce**: every input event runs `refresh()`
(`rebuildView` + `renderBody` + `renderStatus`) synchronously.

- App navbar box: `app.js` → `grid.setGlobalFilter(value)` on `input`.
- Grid's own box: `grid.js` search-input handler → `setGlobalFilter`.
- Column filters: `grid.js` filter-row handler → `refresh()`.

The paste-vs-backspace asymmetry localizes the cost: one full pass over
the data is "fast enough"; the lag is doing it **N times back-to-back**.
Backspacing is worst because each intermediate query is shorter → less
selective → matches more rows → bigger score-sort and bigger `renderBody`
exactly when the most events fire.

## Framing (why self-calibrating works)

This is a **queue-stability** problem: keystrokes *arrive* faster than
refreshes *drain*. When arrival rate > service rate, work piles up and the
UI falls behind. A trailing debounce window relates the two — it coalesces
the keystrokes that land while a refresh would still be running, so we
never queue faster than we can drain. A **leaky-bucket rate limiter of one
refresh per refresh-period.**

Set the window ≈ the measured refresh (service) time:

- service time ≪ inter-key time → window collapses to ~0, refresh every
  keystroke, no perceptible lag (small files stay instant — exactly today's
  behavior).
- service time ≫ inter-key time → window grows to span several keystrokes,
  coalescing precisely when it must (large files).

No magic size threshold, no per-file tuning — the controller tracks the
plant.

## Decisions (agreed)

1. **Strategy: A3 self-calibrating.** Window = last measured `refresh()`
   wall-clock, **seeded at 100 ms** before any measurement, **clamped to
   `[0, 300]` ms**. 300 ms ceiling accepted (a genuinely huge file may
   still queue one pending refresh; better than a half-second freeze per
   keystroke).
2. **Scope: both** global search and per-column filters — both slow down,
   both get the same wiring.
3. **Placement: inside the grid**, so the app navbar, the grid's own box,
   and embedders all benefit. Public `setGlobalFilter(q)` stays
   **immediate** (programmatic contract unchanged).
4. **Trailing-only** (no leading edge). On small files the window is ~0 so
   it makes no difference; on big files a leading-edge front refresh would
   hurt most exactly where we're trying to avoid work.

## Design

Add a small per-instance debounce around the *view rebuild*, driven by the
input-event layer. State (`this.globalFilter`, `this.colFilters[c]`, box
text, active-filter styling, Escape-clear) updates **immediately**; only
the `refresh()` is deferred.

New instance fields (constructor):
- `this._refreshDelay = 100;` — current window (ms); updated from
  measurement.
- `this._refreshTimer = null;` — pending trailing timer handle.

New constant near the others in `grid.js`:
- `const REFRESH_DELAY_MAX = 300;` (seed 100 inline / `REFRESH_DELAY_SEED`
  if we prefer a named pair).

New methods:
- `_scheduleRefresh()` — trailing debounce: clear any pending timer, then
  `setTimeout(() => this._runRefresh(), this._refreshDelay)`. If
  `_refreshDelay <= 0`, call `_runRefresh()` synchronously (no timer churn,
  preserves today's instant feel on small files).
- `_runRefresh()` — clears the timer handle, times `refresh()` with
  `performance.now()` around it, sets
  `this._refreshDelay = clamp(measured, 0, REFRESH_DELAY_MAX)`.

`clamp` is trivial inline (`Math.max(0, Math.min(MAX, x))`); no new util
export needed.

Wiring changes — swap the *event-driven* `refresh()`/`setGlobalFilter`
paths to update state then call `_scheduleRefresh()`:
- Grid search input handler: set `this.globalFilter = inp.value`
  immediately, then `_scheduleRefresh()` (instead of `setGlobalFilter`,
  which would refresh synchronously). Escape-clear stays immediate
  (deliberate single action; can also route through `_scheduleRefresh`, but
  immediate is fine and snappier).
- Grid column-filter input handler: set `this.colFilters[c]` + toggle
  `active-filter` immediately, then `_scheduleRefresh()` instead of
  `refresh()`. Escape-clear immediate as today.
- App navbar (`app.js`): the box currently calls `grid.setGlobalFilter`
  directly, which is immediate. To debounce it without breaking the
  programmatic contract, expose a debounced entry the app uses on `input`.
  Two options — pick one in implementation:
  - **(a)** add `grid.setGlobalFilterDeferred(q)` that sets
    `this.globalFilter = q` then `_scheduleRefresh()`; app `input` handler
    calls it. `setGlobalFilter` stays immediate. **(preferred — explicit,
    documented, mirrors the grid's own box.)**
  - (b) keep `setGlobalFilter` immediate but have the app debounce locally
    — rejected: duplicates logic, embedders wouldn't benefit.

Public `setGlobalFilter(q)` and `clearFilters()` remain **synchronous**
(`refresh()` directly) so programmatic callers and the navbar Clear button
behave exactly as before.

Teardown: `destroy()` must `clearTimeout(this._refreshTimer)` to drop a
pending trailing refresh on a destroyed/reloaded grid. A new `setData`
load doesn't strictly need to cancel it (a late refresh is harmless and
`loadGen` already guards the heavy async paths), but clearing it in
`_install` is tidy and avoids a stray render flash — include it.

## Files touched

- `src/grid/grid.js` — constructor fields, constant, `_scheduleRefresh` /
  `_runRefresh`, `setGlobalFilterDeferred`, input-handler rewiring,
  `destroy` + `_install` timer cleanup.
- `src/app/app.js` — navbar `input` handler → `setGlobalFilterDeferred`;
  bump `VERSION` to `3.6.0`.
- `sw.js` — cache name → `csv-viewer-v3.6.0`.
- `package.json` — `version` → `3.6.0`.
- `npm run build` — rebuild committed `dist/` + python embedded assets
  (grid source changed).
- `CHANGELOG.md` — `## 3.6.0` section.
- `human-hints.md` — session note.
- Smoke test: no logic change to parser/inference/format, so
  `dev/smoke-test.mjs` should pass untouched. Debounce is timing/UI —
  verified manually on a large CSV, not in the node smoke test.

## Verification

- Small/eager file (≤ `eagerCells`): typing/backspacing feels identical to
  today (window converges to ~0).
- Large file: rapid backspacing no longer lags — a burst collapses to one
  trailing refresh; status/row counts settle once after you stop.
- Programmatic `setGlobalFilter` / Clear button still apply immediately.
- Multi-instance: timer + delay are per-instance (no module globals) —
  unaffected.
- `destroy()` mid-type leaves no pending timer firing on a dead grid.

## Out of scope (considered, rejected)

- Forward-typing fast path (filter within current `view` on query
  extension): helps typing, **not** backspacing (the actual complaint);
  adds score-cache state. Skip.
- Render-side changes: `renderBody` already caps at `renderCap` (2048).
