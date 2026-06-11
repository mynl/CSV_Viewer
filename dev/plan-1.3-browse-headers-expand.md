# plan-1.3-browse-headers-expand — browse button, headerless CSVs, expand

From discussion 2026-06-11. v1.2 committed; these execute as **1.3.0**.

## 1. Chrome

- Center the version number under "CSV Viewer" in the header brand.
- Add an explicit blue **Browse** button in the open-file card. Same action
  as clicking the drop zone, but its absence is confusing.

## 2. Headerless CSVs (bank-export style)

Some exports (e.g. the author's bank) ship raw data with no header row.

- **Detection**: the first row is data, not headers, if any cell parses as
  a number or a date (real headers are text). All-text files stay
  ambiguous and keep the current first-row-is-header behavior.
- **Guessed names** by inferred column type: `Date`, `Amount`,
  `Description` — numbered (`Description 1`, `Description 2`) when a type
  appears more than once; integer columns classified as years get `Year`.
- Status bar notes "(headers guessed)" so it's never silent.

## 3. Expand-all-columns toggle

Toolbar toggle (**Expand**): every column gets its natural fully-visible
width — the equal-risk squeeze is bypassed and the table scrolls
horizontally. Toggling re-solves immediately; the preference is sticky for
the session (survives loading a new file).

## Steps

1. Header brand centering; Browse button (+ wiring).
2. `looksHeaderless` + `guessHeaders`; `loadText` branch; status note.
3. Expand toggle in toolbar; `applyLayout` honors it.
4. Smoke tests (headerless detection, name guessing).
5. Bump 1.3.0 (`app.js` + `sw.js` cache name); CHANGELOG; human-hints.

*Stays in `dev/` until the author says it is done.*
