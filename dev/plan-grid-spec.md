# csv_grid spec: clickable rows & cells

**For:** the csv_grid / csv-viewer author (`c:\s\ai\csv-viewer`).
**From:** fiscus (a downstream embedder; renders grids **server-side** via the
`csv_grid` Python emitter `to_html`, page is HTMX-driven, Flask).
**Goal:** let an embedder make a grid's rows/cells **clickable** and, on click,
receive **which row and which cell** was clicked — *as data*, with enough identity
to look the source record back up — so the embedder can show a detail panel,
drill-down, offcanvas, etc.

This is an **additive, opt-in** feature. With the new option off, the grid behaves
exactly as today (no new listeners, no new DOM attributes, no measurable cost). Off
should be the default.

---

## 0. Why the embedder can't do this today

1. `to_html` builds `new CsvGrid(div, payload, opts)` **anonymously** — the embedder
   never gets a handle to the instance, so it can't subscribe to anything or call a
   method.
2. `renderBody()` emits `<tr><td>…</td></tr>` with **no identity**: no `data-*` on
   the row tying the DOM row back to its source row, and the grid **sorts/filters
   client-side** (`this.view` reorders), so DOM row order ≠ data order. A naive
   "Nth `<tr>`" click handler on the embedder side maps to the wrong record the
   moment the user sorts or filters.
3. There is no click event of any kind on the body.

So the embedder needs the grid to (a) emit a click event that (b) carries the
clicked row's **full data keyed by column name** (+ the clicked column), so identity
travels *in the event* and nothing has to be reconstructed from DOM position.

---

## 1. Constraints to honor (from your CLAUDE.md — restated so we're aligned)

- **Vanilla JS, multi-instance.** No module-global state, **no element ids**, **no
  document-level listeners.** The feature below uses exactly **one delegated listener
  on the instance's own `<tbody>`**, attached once at scaffold time — that is
  per-instance and complies.
- **Speed first.** The hot path (`renderBody`) gains **at most one `data-r` attribute
  per `<tr>`**, and only when the feature is enabled. No per-cell attributes, no
  per-cell listeners, no event payload built until an actual click happens.
- **No mode-flipping toggles / explicit actions.** This adds a passive capability
  (emit an event when enabled), not a stateful button.
- **YELL if this is bigger than it looks.** I don't think it is — estimate is ~30–40
  lines in `grid.js`, a few lines of CSS, and ~6 option-map lines in the Python
  emitter. If your read differs, say so before building.

---

## 2. Design in one paragraph

Add a per-grid option (default off). When on: (a) `renderBody` stamps each `<tr>`
with `data-r="<originalRowIndex>"`; (b) one click listener on `<tbody>` resolves the
clicked `<td>`→column and the `<tr>`→original row index, builds a payload (full row
by column name, raw + formatted, plus the clicked column/value), and **dispatches a
bubbling `CustomEvent('csvgrid:cellclick', {detail})` from the grid root**; (c) the
instance is reachable from its root element so a page can also call methods. The
embedder listens for the event (HTMX-friendly) and does whatever it wants. The grid
itself takes **no action** on click beyond optional visual selection — it does not
navigate, fetch, or mutate.

---

## 3. JS API additions (in `src/grid/grid.js`)

### 3.1 New options (constructor `opts`, defaults shown)

```
selectable:   false   // master switch. false = today's behavior exactly.
                      //   true  = emit click events + enable row-data attrs.
selectMode:   'row'   // 'row' | 'cell' | 'none'
                      //   controls the *visual* selection highlight only
                      //   (see 3.4). Event is emitted regardless when
                      //   selectable is true; this just styles what's active.
hiddenColumns: null   // string[] of column names to carry in the data + event
                      //   payload but NOT render as visible columns. Lets an
                      //   embedder ship a key column (e.g. 'trans_id') without
                      //   showing an ugly id column. null = show all.
```

Notes:
- `selectable:false` (the default) must be a true no-op: do not attach the body
  listener, do not stamp `data-r`, do not add cursor styling.
- `hiddenColumns` is a convenience; if it's more than trivial, it can be a **phase 2**
  — see §7. If you skip it, the embedder will just show the key column. Flag your
  preference.

### 3.2 New event: `csvgrid:cellclick`

Dispatched from **the grid root element** (`this.root`), `bubbles: true`,
`composed: true`, `cancelable: true`. One event covers both row and cell use cases —
the embedder decides whether it cares about the whole row or the specific cell.

`event.detail` schema:

| field            | type              | meaning |
|------------------|-------------------|---------|
| `name`           | string            | the grid's `name` (status-line label) so a page with several grids can route. `''` if unset. |
| `rowIndex`       | number            | **original** row index into the source data (stable; not the view position). |
| `viewIndex`      | number            | position within the current filtered/sorted view (mostly for debugging). |
| `column`         | string            | clicked column's **header name**. |
| `columnIndex`    | number            | clicked column index. |
| `value`          | string\|number\|null | clicked cell's **raw** value (as loaded; numbers stay numbers where the grid has them, else the raw string). |
| `valueText`      | string            | clicked cell's **formatted/displayed** text (what the user saw; `''` for blanks). |
| `row`            | object            | **the whole row, raw**, keyed by column name (includes `hiddenColumns`). This is the identity payload — e.g. `row.trans_id`. |
| `rowText`        | object            | the whole row, **formatted** text, keyed by column name. |
| `originalEvent`  | MouseEvent        | the underlying click (so the embedder can read modifier keys, target, etc.). |

Rationale for "full row by column name": it removes any need for the embedder to
reconstruct identity from DOM position, and it survives sort/filter for free. The
embedder picks whatever key column(s) it needs out of `detail.row`.

`cancelable: true` is so an embedder *could* `preventDefault()` to suppress the
built-in selection highlight if it wants to manage that itself. (Optional nicety.)

### 3.3 Reaching the instance from its element

Because `to_html` constructs the grid anonymously, expose a handle **on the element**
(no module globals, no ids):

```
// in constructor, after root is resolved:
this.root.csvgrid = this;          // instance handle on its own root

// static convenience:
static forElement(elOrSelector) {  // returns the CsvGrid on that root, or null
    const el = typeof elOrSelector === 'string'
        ? document.querySelector(elOrSelector) : elOrSelector;
    return el ? (el.csvgrid || null) : null;
}
```

This lets a page call `CsvGrid.forElement(root).getSelection()` etc. It's also the
documented way for the embedder to find the right instance from an event
(`event.target.closest('.csvgrid').csvgrid`).

### 3.4 Selection highlight (visual only)

When `selectable:true` and `selectMode !== 'none'`, on a body click set a selection
and re-style:
- `selectMode:'row'` → add class `csvgrid-selected` to the clicked `<tr>` (clear it
  from any previously selected row in this instance).
- `selectMode:'cell'` → add `csvgrid-selected` to the clicked `<td>` (and optionally
  `csvgrid-selected-row` to its `<tr>`).

Selection is **per instance**, tracked by original `rowIndex` (+ `columnIndex` for
cell mode) so it can be re-applied after a re-render (sort/filter/expand). If
tracking-across-rerender is more than a couple of lines, it's acceptable for v1 to
clear selection on re-render — note which you did.

New methods (small):
```
getSelection()      // -> { rowIndex, columnIndex, row, ... } | null  (same shape as detail)
clearSelection()    // remove highlight + state
selectRow(rowIndex) // programmatic select + scrollIntoView (optional; nice for
                    //   "highlight the row the detail panel is showing")
```

### 3.5 CSS (in `grid.css`, `.csvgrid-*` namespaced)

- `.csvgrid[data-selectable] tbody tr { cursor: pointer; }` (affordance, only when on).
- `.csvgrid tbody tr.csvgrid-selected { background: <subtle accent>; }`
- `.csvgrid tbody td.csvgrid-selected { outline: 2px solid <accent>; }`
- Respect existing hover styling; selection should read clearly in **both** light and
  dark themes.

Set a `data-selectable` attribute (or class) on the root when the option is on, both
to drive the cursor CSS and to give the embedder a server-visible hook.

### 3.6 Implementation sketch (illustrative, not prescriptive)

```js
// _buildScaffold(), after body is created, only when selectable:
if (this.opts.selectable) {
    this.root.dataset.selectable = '';
    this.els.body.addEventListener('click', e => this._onBodyClick(e));
}

// renderBody(): when selectable, stamp the row's ORIGINAL index
// parts.push(`<tr${this.opts.selectable ? ` data-r="${r}"` : ''}>${cells}</tr>`);

_onBodyClick(e) {
    const td = e.target.closest('td');
    const tr = e.target.closest('tr');
    if (!td || !tr || !tr.dataset.r) return;
    const r = +tr.dataset.r;                       // original row index
    const c = [...tr.children].indexOf(td);        // column index
    const frow = this.getFormattedRow(r);
    const row = {}, rowText = {};
    this.headers.forEach((h, i) => {
        row[h] = this.rows[r][i] ?? null;          // or col.values[r] for numerics
        rowText[h] = frow[i] ?? '';
    });
    // (apply selection highlight here per selectMode)
    const detail = {
        name: this.fileName, rowIndex: r, viewIndex: this.view.indexOf(r),
        column: this.headers[c], columnIndex: c,
        value: this.rows[r][c] ?? null, valueText: frow[c] ?? '',
        row, rowText, originalEvent: e,
    };
    const ev = new CustomEvent('csvgrid:cellclick',
        { detail, bubbles: true, composed: true, cancelable: true });
    if (!this.root.dispatchEvent(ev)) return;      // embedder preventDefault'd
}
```

(`composed:true` only matters if you ever shadow-DOM the grid; harmless otherwise.)

---

## 4. Python emitter additions (`python/src/csv_grid/__init__.py`)

Add to `_OPTION_MAP`:
```
"selectable":     "selectable",
"select_mode":    "selectMode",
"hidden_columns": "hiddenColumns",
```
These then flow through `to_html` / `show` unchanged. Update the `show()` docstring's
option list to mention them.

Document the usage in the package README:
```python
to_html(df, name="transactions",
        selectable=True,
        select_mode="row",
        hidden_columns=["trans_id"])   # carried in event.detail.row, not displayed
```

No Python-side callback is needed or wanted — the embedder wires behavior to the DOM
event, which keeps `to_html` a pure string emitter and the data flow one-directional.

---

## 5. How fiscus will use it (worked example — informational, you don't build this)

fiscus adds **one** small delegated listener in its own `base.html` (the embedder's
code — *not* the grid's, so your "no document listeners" rule stays intact on your
side), bridging the grid event to an HTMX fetch:

```html
<script>
document.addEventListener('csvgrid:cellclick', (e) => {
  const d = e.detail;
  if (d.name !== 'transactions') return;           // route by grid name
  const id = d.row.trans_id;                        // identity from the payload
  htmx.ajax('GET', `/transactions/${id}`,           // -> detail fragment
            { target: '#row-detail', swap: 'innerHTML' });
});
</script>
```

The fragment opens in a right-side offcanvas (fiscus already has the help offcanvas
pattern). A cell click is the same event — fiscus reads `d.column` / `d.value` to,
say, copy the cell or filter by it. **Everything fiscus needs rides in `e.detail`;**
your grid only has to emit it.

This replaces fiscus's current hand-rolled clickable `<table>`s (Missing, Rules
pages) with real csv_grid grids that keep sort/filter/fzf and *also* drill down.

---

## 6. Edge cases & requirements

- **Survives sort/filter/expand.** `rowIndex` must be the original source-row index,
  not the view position. (This is the whole point — verify with a sort + a filter
  applied before clicking.)
- **Blank cells** (`·` placeholder): `value` should be the raw `null`/`''`, not the
  `·` glyph; `valueText` is `''`.
- **Numeric columns:** `value` should be the typed number where the grid has it
  (`col.values[r]`), falling back to the raw string otherwise. State which you do.
- **Resizer grip / sort arrows:** body clicks only; header clicks (sort) and the
  resize grip live on `<th>` and are unaffected. Confirm a drag-resize that ends over
  a body cell doesn't fire a spurious click (it shouldn't — different target).
- **Text selection:** a plain click selects; if the user is drag-selecting text,
  that's still a click on mouseup — acceptable. Don't suppress native selection.
- **Multi-grid pages:** event carries `name`; instance reachable via
  `event.target.closest('.csvgrid').csvgrid`. Two grids with the same `name` is the
  embedder's problem, but please pass `name` through verbatim.
- **`render_cap` / "show all":** stamping `data-r` must use the **original** index for
  every rendered row including after "show all".
- **No data / error states:** no rows → no listener work; fine.

## 7. Suggested phasing

- **Phase 1 (the must-have):** `selectable` option, `data-r` stamping, the
  `<tbody>` listener, the `csvgrid:cellclick` event with the full `detail` schema,
  `root.csvgrid` handle + `CsvGrid.forElement`. Python: the three option-map lines.
  This alone fully unblocks fiscus.
- **Phase 2:** `selectMode` visual highlight + `getSelection`/`selectRow`,
  selection survival across re-render, CSS for both themes.
- **Phase 3:** `hiddenColumns`. If omitted, embedders display the key
  column; not a blocker.

## 8. Non-goals (explicitly out of scope)

- No navigation, fetching, or DOM mutation by the grid on click — it only emits.
- No Python callbacks / server round-trips inside `csv_grid`.
- No double-click / right-click / keyboard-activation semantics in v1 (could be
  added later as `csvgrid:celldblclick` etc. following the same payload shape).
- No multi-select / range-select in v1 (single selection only).

## 9. Acceptance checklist

- [ ] With `selectable` unset/false: byte-for-byte identical DOM and behavior to
      today; no new listeners; no `data-r`; no perf delta on a large grid.
- [ ] With `selectable:true`: clicking any body cell dispatches one bubbling
      `csvgrid:cellclick` whose `detail.rowIndex` is the original source row, correct
      **after** sorting and column-filtering.
- [ ] `detail.row` contains every column (incl. `hiddenColumns`) keyed by name, with
      raw values; `detail.column`/`value`/`valueText` identify the clicked cell.
- [ ] `CsvGrid.forElement(root)` returns the instance; `root.csvgrid` is set.
- [ ] (Phase 2) selected row/cell is visibly highlighted in light **and** dark theme;
      `getSelection()` matches the last event; `clearSelection()` works.
- [ ] Python `to_html(df, selectable=True, select_mode='row', hidden_columns=[...])`
      round-trips the options; README + `show()` docstring updated.
- [ ] `dist/` rebuilt (`npm run build`) and the python package's embedded assets
      refreshed — the smoke test won't catch a stale dist.
- [ ] `CHANGELOG.md` + `human-hints.md` updated.

---

### One open question for you (RESOLVED)

Do you want the event named `csvgrid:cellclick` (one event, row+cell both in the
payload — my recommendation, simplest) or a split `csvgrid:rowclick` /
`csvgrid:cellclick` pair? I prefer the single event; fiscus reads `detail.column`
when it cares about the cell and ignores it when it cares about the row. Your call.

User: agree - one event row and cell in the payload. 
