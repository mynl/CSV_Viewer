# csv-grid — Copy / Save toolbar buttons (requirements)

**Purpose.** Give every rendered grid a built-in way to **copy** its data to the
clipboard or **save** it to a file, in **CSV** or **Markdown**, without the embedding
app having to build and wire its own buttons. Today the grid already knows how to
serialize itself (`export({scope, format, values})`) but ships no UI for it — each
consumer has to reinvent buttons. Move that UI into the grid, next to Expand /
Contract, with an option to turn it off.

This document is **requirements only** — the *what* and the *why*, not the *how*.
Naming, widget choice, and internals are the implementer's call except where a
requirement pins user-visible behavior.

---

## Where this lands

- **Grid (JS):** `src/grid/grid.js` — the toolbar is generated in `_buildScaffold`;
  the serializer is the existing public `export({scope, format, values})` method.
- **Python wrapper:** `python/src/csv_grid/__init__.py` — `show()` / `to_html()`
  option plumbing (`_OPTION_MAP`) and docstrings; the built asset
  `python/src/csv_grid/assets/csv-grid.iife.js` is refreshed by `npm run build`.
- **Styling:** existing `.csvgrid-toolbar` / `.csvgrid-btn` classes (JS side) and the
  Python-side `csv-grid.css`.

The serialization engine already exists and is unchanged in spirit — this is a **UI +
option** feature on top of `export()`. Reuse it; don't write a second serializer.

---

## Terminology (already defined by `export()`)

- **scope** — `view` = the rows currently shown (after fzf search + column filters +
  sort); `all` = every row, original order, unfiltered. **"Selected rows" in the
  requester's vocabulary means exactly this `view` scope** — the rows left visible
  after filtering/searching. There is no separate tick-box row selection (see
  Non-goals).
- **format** — `csv` (RFC 4180) or `md` (Markdown pipe table).
- **values** — `formatted` = cells exactly as displayed (money at 2dp, ISO dates,
  etc.); `raw` = cells as loaded. `formatted` already degrades to `raw` above
  `renderCap` — see Req-Large-Grid.

---

## Functional requirements

### Req-Buttons-Present
When enabled, the grid renders a **Copy** control and a **Save** (download) control in
its own toolbar. Both are reachable in one or two clicks. The user must be able to
reach every one of these combinations:

- **Copy** → clipboard, and **Save** → file  *(both sinks required)*
- **CSV** and **Markdown**  *(both formats required)*
- **This view** (rows visible after fzf/filter/sort — i.e. the "selected" rows) and
  **All rows**  *(both scopes required)*
- **Formatted** values (default) and **Raw** values  *(formatted required; raw
  strongly recommended, see Req-Values-Default)*

The exact widget (two split/dropdown buttons, a small button cluster, a menu, …) is
the implementer's choice, subject to Req-Layout and Req-Compact. The requirement is
that all the combinations above are **reachable**, with the common case being one
click (see Req-Values-Default).

### Req-Placement
The controls sit in the existing toolbar, **to the right of Expand / Contract**.
They belong to the toolbar's button area, not a separate bar.

### Req-Layout
The controls follow the existing toolbar house style — same button look as
`.csvgrid-btn`, same height/spacing, same dark-mode behavior. They must not push the
fzf search box off-screen at narrow widths; wrapping or condensing is acceptable, a
broken/overflowing toolbar is not.

### Req-Compact
Adding these controls must not clutter the toolbar. Prefer a small number of controls
(e.g. a **Copy ▾** and a **Save ▾**, each opening a short menu for format / scope)
over a wide row of many buttons. This is a recommendation on density, not a mandate on
the specific widget.

### Req-Values-Default
The **one-click / default** action uses **`scope = view`** and **`values =
formatted`** — i.e. "give me what I'm looking at, formatted the way I see it." Raw and
All-rows are secondary choices the user opts into. Rationale: the primary use is a
human eyeballing/reconciling a table and wanting exactly that table.

*(Note: the underlying `export()` default is `raw`; the button layer overrides to
`formatted`. That's intentional — the buttons are for humans, the API default is for
programs.)*

### Req-Copy-Behavior
The Copy control writes the serialized string to the clipboard and gives brief,
non-modal confirmation that it worked (e.g. the button momentarily reads "Copied" or
shows a check). No dialog, no page navigation.

### Req-Save-Behavior
The Save control downloads a file containing the serialized string. It must not
navigate the page or open a new tab that the user then has to save manually — it
downloads directly.

### Req-Filename
The downloaded file is named from the grid's `name` (the status-line label) when one
was supplied, otherwise a neutral fallback (e.g. `grid`). The extension matches the
format (`.csv` / `.md`). The name is sanitized to a safe filename (no path
separators, no characters illegal on Windows/macOS/Linux). Example: a grid named
`statement` saved as Markdown → `statement.md`.

### Req-Enable-Option
There is a single option to **show or hide** these controls, defaulting to
**shown**, consistent with `expandButtons` (which also defaults on). Names:

- JS option: a camelCase flag on `CsvGrid` (e.g. `exportButtons`), default `true`.
- Python: the matching snake_case option (e.g. `export_buttons`) threaded through
  `_OPTION_MAP`, default `true`, so a caller can pass `export_buttons=False` to
  suppress them per grid (mirrors how `column_filters=False` is passed today).

A consumer that wants a bare grid (e.g. a tiny read-only manifest, or a grid whose
only interaction is cell-click drill) must be able to turn the buttons off with this
one flag.

### Req-Toolbar-Visibility
The toolbar currently renders only when `globalSearch` or `expandButtons` is on. It
must also render when the export controls are enabled — so a grid with search and
expand both off but export on still shows a toolbar containing just these controls.

---

## Correctness & edge cases

### Req-Visible-Columns
Copy/Save from the buttons should reflect **what the user sees**: columns hidden via
`hiddenColumns` should **not** appear in the button-driven output by default. This
differs from the current `export()` behavior, where hidden columns ride along in the
serialized output. Reconcile this so a user copying a grid doesn't silently get
internal key/provenance columns they can't see. (Whether that means the buttons
request column exclusion, or `export()` gains an option, is the implementer's call —
the *requirement* is: **button output = visible grid** unless a future explicit option
says otherwise.)

### Req-Large-Grid
For large grids where `formatted` would exceed `renderCap`, `export()` already falls
back to `raw`. That fallback must remain safe (no multi-second stall on click) and
must not misreport — if the output silently became raw, the user shouldn't be told it's
formatted. Behavior here should be no worse than the current `export()` contract.

### Req-Empty-Grid
Copy/Save on an empty grid (headers only, zero rows) must not error. It produces a
header-only CSV/Markdown (or is harmlessly inert) — implementer's choice, but no
exception and no broken download.

### Req-Multi-Grid
Multiple grids on one page each operate on their **own** data. A page can hold several
grids (some of the consuming apps show two or more); each toolbar's Copy/Save must act
only on its own instance. (The grid already scopes per-instance via `root.csvgrid`;
just don't regress it with any global/shared state.)

### Req-Clipboard-Availability
Use the standard async clipboard path. In the target deployments the grid runs in a
secure context (localhost / https), so the clipboard API is available; if it is ever
unavailable, fail gracefully (e.g. fall back or show an unobtrusive "couldn't copy"
state) rather than throwing.

### Req-Accessible
The controls are real, keyboard-reachable buttons with descriptive
titles/aria-labels (e.g. "Copy this view as CSV"), consistent with the existing
toolbar buttons.

---

## Python wrapper requirements

### Req-Python-Option
`show()` and `to_html()` accept the new snake_case option, map it through
`_OPTION_MAP`, and document it in their docstrings alongside `expand_buttons` /
`global_search`. Passing an unknown option must keep raising as it does now.

### Req-Version-Assets
Bump the `csv_grid` package version and rebuild the bundled asset
(`npm run build` → refreshed `csv-grid.iife.js` / `csv-grid.css`) so consumers pip-/
path-installing the wrapper pick up the new toolbar. Note the version bump in the
package's changelog/notes.

---

## Non-goals (call out explicitly)

- **Arbitrary tick-box multi-row selection export.** "Selected rows" here means the
  rows visible after fzf search / column filtering (the `view` scope) — **not** a
  per-row checkbox model. The user narrows the export by filtering the grid, then
  exports the view. A literal "tick these N arbitrary rows, export just those" feature
  is out of scope; if ever wanted it's a separate selection-model change.
- **Excel/XLSX or other binary formats.** CSV and Markdown only.
- **Server round-trips.** Everything is client-side off the already-loaded data; no
  new network path, no new endpoint.
- **Changing the default serialization semantics of the existing `export()` API** for
  programmatic callers (its default stays `values='raw'`); only the *button* layer
  defaults to formatted.

---

## Open decisions for the maintainer

1. **Widget shape** — two split/dropdown buttons ("Copy ▾", "Save ▾") vs a compact
   button cluster. Requirements only demand the combinations be reachable and the
   toolbar stay uncluttered (Req-Compact).
2. **Raw-vs-formatted exposure** — formatted is the required default; how prominently
   to surface the raw alternative (a menu item, a toggle, or omit raw entirely) is
   open, but raw is strongly recommended to be reachable.
3. **Hidden-columns reconciliation** (Req-Visible-Columns) — exclude at the button
   layer, or add an option to `export()`. Either satisfies the requirement.

---

## Acceptance checklist

- [ ] With defaults, a grid shows Copy and Save controls to the right of
      Expand / Contract.
- [ ] One click copies the current view as formatted CSV; a brief confirmation shows.
- [ ] One click / short menu saves the current view as a file named from the grid's
      `name` with the right extension.
- [ ] Markdown output is reachable for both Copy and Save.
- [ ] "All rows" scope is reachable and exports every row regardless of the active
      filter/sort.
- [ ] Raw values are reachable (if surfaced) and differ from formatted where formats
      apply.
- [ ] `export_buttons=False` (Python) / the JS flag off hides the controls; the rest
      of the toolbar is unaffected.
- [ ] A grid with search and expand off but export on still shows a toolbar with just
      these controls.
- [ ] Hidden columns do not appear in button-driven output.
- [ ] Two grids on one page export their own data independently.
- [ ] Empty grid and very large grid (formatted → raw fallback) both behave without
      error or stall.
- [ ] Python `show()` / `to_html()` accept and document the new option; version
      bumped and asset rebuilt.

---

## Implementation (the *how* — added by maintainer)

### Guiding fact: the UI already exists, in the app

The viewer chrome already ships the entire copy/save feature — two Bootstrap
split-buttons + a narrow "More" menu in `index.html`, wired by
`initExport` / `runExport` / `copyText` / `saveText` / `exportBaseName` /
`flash` in `src/app/app.js` (≈ lines 227–300). It disables the grid's own
toolbar buttons (`globalSearch:false, expandButtons:false`) because the navbar
owns search + Expand/Contract, and its copy/save call `grid.export(...)`.

**So this feature is not new logic — it is relocating proven logic down into
`src/grid/` so library embedders (blog qmd, python wrapper) get it for free,
then reconciling the app so it doesn't render the buttons twice.** The clipboard
path, the BOM rule, the download-via-anchor pattern, the flash confirmation are
all copy-from-app, DOM-namespace-adjusted. No serializer is written; `export()`
stays the engine.

### Strategy in one line

Add a small **`exportButtons`** option (default `true`); in `_buildScaffold`,
after Expand/Contract, render two `<details>`-based menus ("Copy ▾", "Save ▾");
each menu item calls a new private sink method that wraps the existing
`export()`. Port `copyText`/`saveText`/filename logic into the grid namespace,
teach `export()` to optionally drop hidden columns, and thread the snake_case
option through the Python `_OPTION_MAP`. Finally, have the app pass
`exportButtons:false` so its bespoke navbar UI is unchanged.

### Widget choice: native `<details>` disclosure menus

The grid has **no dropdown machinery** today — only `.csvgrid-btn`, no Bootstrap,
and a hard rule: **no document-level listeners inside `src/grid/`** (multi-
instance safety). A Bootstrap-style dropdown needs outside-click dismissal, which
normally wants a document listener. To avoid that entirely, use the native
`<details><summary>Copy ▾</summary>…</details>` disclosure element:

- Toggle is 100% native — zero JS, no listeners, keyboard-reachable, accessible.
- Each menu is a `<details class="csvgrid-menu">` whose panel holds real
  `<button>` items. An item's click handler runs the export **and** sets
  `details.open = false` to close.
- To keep only one menu open at a time (tidiness, not a requirement), listen for
  `toggle` **on the `<details>` elements themselves** (per-instance, element-
  level — compliant), closing siblings when one opens. Optional; can ship without.

This satisfies Req-Compact (two controls, each a short menu), Req-Layout (built
from `.csvgrid-btn` look), Req-Accessible (native semantics), and the no-document-
listener rule. Menu contents (8 items) mirror the app's "More" menu exactly:

```
Copy ▾                          Save ▾
  Current view → CSV              Current view → CSV
  Current view → Markdown         Current view → Markdown
  Whole table → CSV               Whole table → CSV
  Whole table → Markdown          Whole table → Markdown
  ─────────────────               ─────────────────
  [ ] Formatted values            [ ] Formatted values
```

The `<summary>` itself (single click, no menu open needed if the user just
clicks the primary face) performs the **default one-click action**: view / CSV /
**formatted** (Req-Values-Default). Because `<summary>` click also toggles the
`<details>`, the cleanest split is: `<summary>` opens the menu (its label reads
"Copy ▾"), and the first menu item is the primary action. If a true one-click-
without-opening is wanted, add a separate flat "Copy" `.csvgrid-btn` *beside* the
"▾" menu button (app-style split). **Recommend the split**: flat `Copy` button
(view/CSV/formatted, one click) + `▾` menu for the rest — closest to the app and
to Req-Buttons-Present "common case is one click."

### File-by-file changes

**`src/grid/grid.js`**

1. Options block (~line 101): add `exportButtons: true`. Update the header
   doc-comment options list (lines 15–66) to document it next to `expandButtons`.

2. `_buildScaffold` toolbar guard (line 164): change to
   `if (o.globalSearch || o.expandButtons || o.exportButtons)` (Req-Toolbar-
   Visibility). Add an `if (o.exportButtons) { … }` block after the
   `expandButtons` block that builds the Copy/Save split-button + `<details>`
   menus, wiring each item to `this._runExport(sink, scope, format, formattedFlag)`.
   Store the "Formatted values" checkbox per menu (or one shared flag).

3. New private methods, ported from `app.js` and re-namespaced:
   - `_runExport(sink, scope, format, values)` → `const text = this.export({scope, format, values, visibleOnly:true}); sink==='copy' ? this._copyText(text, btn) : this._saveText(text, format, btn)`.
   - `_copyText(text, btn)` — `navigator.clipboard.writeText` with the hidden-
     textarea `execCommand` fallback (Req-Clipboard-Availability), then
     `_flash(btn,'Copied'/'Copy failed')`.
   - `_saveText(text, format, btn)` — Blob + object URL + `<a download>`; CSV gets
     the UTF-8 BOM, md none (port verbatim); filename from `_exportBaseName()`.
   - `_exportBaseName()` — `this.fileName` with extension stripped **and
     sanitized** (Req-Filename): replace `[<>:"/\\|?*\x00-\x1f]` and trailing
     dots/spaces, fallback `'grid'`.
   - `_flash(btn, msg)` — save `btn.textContent`, set to `msg`, add a transient
     `.csvgrid-flash` class, restore after ~1.2 s. Simpler than the app's version
     (no `.btn-label` span to juggle). Guard against double-flash with a stored
     timer id per button.

4. `export()` (line 481): add `visibleOnly = false` to the destructured options.
   When true, project headers/rows/aligns through `this.visibleCols`
   (Req-Visible-Columns) — default stays the current all-columns behavior so the
   **programmatic API is unchanged** (respects the Non-goal). Concretely:
   ```
   const cix = visibleOnly ? this.visibleCols : this.cols.map((_,c)=>c);
   const headers = cix.map(c => this.headers[c]);
   // formatted path: getFormattedRow(r) then pick cix; raw path: cix.map(c=>rows[r][c]);
   // md aligns: cix.map(c => …this.cols[c]…)
   ```

**`src/grid/grid.css`** — add `.csvgrid-menu` (details/summary reset: remove the
default marker, style `<summary>` as a `.csvgrid-btn`, absolutely-position the
panel, `.csvgrid-menu[open]` panel visible, dark-mode via the existing
`--csvgrid-*` vars), a menu-item button style, and a `.csvgrid-flash` tint. This
is the only CSS source; `npm run build` refreshes `dist/csv-grid.css` **and** the
python-side copy.

**`src/app/app.js`** — set `exportButtons:false` in the `new CsvGrid(...)` options
(line 351) so the grid does **not** render its own buttons; the navbar keeps its
existing UI unchanged. **Optional dedup:** the app's `copyText`/`saveText`/
`exportBaseName` now duplicate the grid's; could be deleted in favor of new public
`grid.copyExport({...})` / `grid.saveExport({...})` methods that both the grid
buttons and the navbar call. Cleaner, but a larger diff and touches working app
code — recommend deferring; note it and keep the app as-is for this pass.

**`python/src/csv_grid/__init__.py`** — add `"export_buttons": "exportButtons"`
to `_OPTION_MAP` (Req-Python-Option); document `export_buttons : bool, default
True` in the `show()` docstring's options list next to `expand_buttons`. Bump
`__version__`. (`_map_options`' unknown-key raise is unchanged — Req-Python-Option
edge case already holds.)

**Version + build (Req-Version-Assets):** bump `VERSION` in `app.js`, the `sw.js`
cache name, `package.json`, `pyproject.toml`, and `__init__.__version__` (all five
— see `version-numbers-aligned` memory), run `npm run build` (refreshes `dist/`
and `python/.../assets/csv-grid.iife.js` + `.css`), add a `CHANGELOG.md` section,
and update `human-hints.md`.

**Tests (`dev/smoke-test.mjs`):** the sinks are DOM/browser-only (clipboard,
`<a download>`), so they can't run under Node. What *can* be smoke-tested is the
pure part: `export({visibleOnly:true})` drops `hiddenColumns` from both CSV and md
output, and the filename sanitizer. Add those; the button/menu wiring is verified
by eye in `dev/embed-test-es.html` (add a grid with `hiddenColumns` + default
`exportButtons`).

### Reachability matrix (Req-Buttons-Present — all must be reachable)

| | CSV | Markdown |
|---|---|---|
| **View · formatted** | Copy (1-click) / Save (1-click) | menu item |
| **View · raw** | menu + Formatted off | menu + Formatted off |
| **All · formatted** | menu item | menu item |
| **All · raw** | menu + Formatted off | menu + Formatted off |

---

## Concerns / flags (⚠ read before "go ahead")

1. **⚠ Size/scope — this is bigger than "the grid just controls the buttons."**
   The grid has no menu/dropdown system and a no-document-listener rule. Even the
   lean `<details>` approach adds ~60–100 lines of JS + a block of new CSS to
   `src/grid/`, plus the `export()` change, plus Python + version + rebuild.
   It's not huge, but it's not a one-liner — it's a genuine UI component. If you'd
   rather keep `src/grid/` tiny, an alternative is to ship only **two flat
   one-click buttons** (Copy = view/CSV/formatted, Save = view/CSV/formatted) and
   leave format/scope/raw to embedders via `export()` — but that fails several
   "reachable" requirements. Flagging so you decide the trade before I build.

2. **App double-UI reconciliation.** Because `exportButtons` defaults `true`, the
   app **must** opt out (`exportButtons:false`) or it grows a second copy/save
   next to its navbar one. Cheap, but easy to forget → acceptance item.

3. **`export()` semantics split.** Buttons want visible-only + formatted default;
   the programmatic API keeps all-columns + raw default. Handled by the
   `visibleOnly` param and the button layer overriding `values:'formatted'` — no
   change to existing callers. Just noting the intentional asymmetry (already
   blessed by the spec's Non-goal + Req-Values-Default note).

4. **`<summary>` click both toggles the menu and could fire the default action.**
   Pick one: either the summary only opens the menu (default action = first item),
   or a real split (flat button + separate `▾`). Recommend the split for true
   one-click; it's what the app does. Minor, but decide up front.

5. **Menu open/close polish without document listeners.** One-menu-at-a-time and
   click-outside-to-close are nice-to-haves, not requirements. `<details>` closes
   on item click (we set `open=false`); it does **not** auto-close on outside
   click natively. I propose shipping without outside-click-close (compliant,
   slightly less slick) rather than reaching for a document listener. Confirm
   that's acceptable.

6. **Raw fallback messaging (Req-Large-Grid).** The flash says only "Copied" /
   "Saved" — never "formatted" — so a silent formatted→raw fallback above
   `renderCap` can't misreport. No extra work; just confirming the requirement is
   met by *not* labeling the result.
