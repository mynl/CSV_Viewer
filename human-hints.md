# human-hints

Very high-level running summary of discussions and decisions in this
project. Newest first. The pinned section below tracks the current
formatting rules.

## Number & date formatting rules (current as of v1.4)

Per numeric column, first match wins:

1. **Year** — all integers AND (header matches `year|yr|vintage|cohort`
   OR all values in 1800–2030): plain, no commas (`1995`).
2. **Money by header** — header matches `amount|amt|balance|price|cost|
   fee|charge|paid|payment|debit|credit|total|premium|loss|salary|wage|
   income|expense|revenue` or a currency symbol/code: exactly 2dp with
   commas, even for all-integer columns.
3. **Integer** — all integer-valued: commas, 0dp.
4. **Money by value** — floats with ≤ 2 observed decimals and max |x|
   < 100,000: exactly 2dp ("probably money").
5. **Engineering** — floats spanning > 6 orders of magnitude: 3
   significant digits with SI suffixes n µ m k M G T (`4.5M`).
6. **Sensible float** (the white-whale rule) — uniform decimals
   `d = clamp(min(maxObservedDecimals, 3 − floor(log10(mean |x| over
   nonzero))), 0, 6)`: ~4 significant digits at the column's typical
   magnitude, never more precision than the raw data carried. Example:
   mean ~10⁵ → 0dp; mean ~10 → 2dp; mean ~0.02 → up to 5dp (capped by
   observed precision).

Dates: recognized liberally (ISO, `13/01/2024`, `13-05-24`, `13.05.2024`,
`5 Jan 2024`, `05-Jan-24`, `Jan 5, 2024`; 2-digit years pivot at 50);
day-first vs month-first decided **per column** (any day > 12 flips the
column to day-first, else US month-first); always displayed ISO
`yyyy-mm-dd`, center-aligned. Numbers right, text left. Number parsing
accepts `1,234.56`, `(2,500)`, `$99.50`, `12.5%`, `1e-03`, `.5` (v1.4.1:
scientific notation, with exponent-aware implied decimals).

Search note (by design, confirmed 2026-06-11): the global box matches
against each row's cells concatenated into one string — formatted values
first, then raw values. So `^` anchors the start of the first column and
`$` the end of the last RAW cell (which can differ from the displayed
value). For per-cell matching use the column filter boxes.

## 2026-06-11 — v1.4.1 / v1.4.2: sci-notation fix, column drag-resize

- 1.4.1 (committed): `1e-03` etc. now parse as numbers (one such value
  was demoting whole columns to text).
- 1.4.3: Expand/Contract as two separate buttons — UI principle for this
  project (and generally): **no buttons that change meaning** (the
  infamous play/pause). Contract = back to fitted layout, clears dragged
  widths.
- 1.4.2: drag-resize grips on header edges + double-click-to-fit-content.
  Steve's take, agreed: resizing is a crutch — the machine should get
  widths right — but it's expected in this kind of app, and double-click
  covers the real use case (one wide column to inspect).

## 2026-06-11 — v1.4.0: header toggle, liberal dates, money 2dp

- v1.3 committed by Steve. v1.4
  (dev/plan-1.4-header-toggle-dates-money.md): "Row 1 = header" toolbar
  toggle (re-interprets loaded data either way); liberal date recognition
  with per-column US/UK disambiguation; money rules (header or value)
  forcing 2dp ahead of the clever float rule; BOM + leading-blank-line
  stripping (fixes the bank download that loaded as one column).
- Formatting rules now pinned at the top of this file — Steve's tracker.
- Test fixture: dev/sample-bank-uk.csv (BOM, blank lines, day-first).

## 2026-06-11 — v1.3.0: browse, headerless bank CSVs, expand toggle

- v1.2 committed by Steve. v1.3 (dev/plan-1.3-browse-headers-expand.md):
  explicit Browse button on the ingest card, centered header version,
  headerless-CSV detection (first row contains a number/date → data) with
  type-guessed names (Date / Amount / Description / Year, numbered), and
  a sticky toolbar Expand toggle (natural widths + horizontal scroll,
  bypassing the equal-risk squeeze).
- Install-as-app recipe: serve (`python -m http.server 8080`), open
  http://localhost:8080 in Edge, install icon in the address bar (or
  … menu → Apps → Install). After first load the service worker keeps the
  shell working even when the server is down.

## 2026-06-11 (late night) — v1.2 job lot: ?src=, PWA, plan renames

- Verdict so far: gummage.
- Plan naming convention now `plan-<version>-<desc>.md`; all three plans
  renamed (1.0-initial-viewer and 1.1-fuzzy-and-widths in dev/done;
  1.2-formatting-keyboard-pwa active). Convention recorded in CLAUDE.md
  and claude-generic.md.
- `?src=<url>` loader added (auto-loads a CSV from the query string) —
  the enabler for embedding in the blog post via iframe.
- PWA added: manifest + service worker (offline app shell, installable
  from Edge on localhost/https). Steve knows PWA ≠ file association — he
  just likes and uses PWAs. `?src=` data is never cached. File
  association (`file_handlers`/`launchQueue`) deliberately not wanted.
- All in v1.2.0; Steve tests and commits the job lot.

## 2026-06-11 (night) — v1.2.0 shipped: formatting, keyboard, chrome

- Formatting spec = greater_tables (Steve is **very** anal about
  formatting; recorded in CLAUDE.md): integers comma'd, years plain
  (header year-ish or all values 1800–2030), engineering format for
  wide-ranging floats, dates ISO **center-aligned**.
- White-whale "sensible float format" candidate adopted: per-column
  uniform decimals = min(observed precision, 3 − floor(log10(mean |x|))),
  clamped 0–6 — ~4 significant digits at typical magnitude. Awaiting
  field verdict.
- Also: Ctrl+O open, Esc clears filter boxes, bi-table SVG favicon,
  version under the header brand, table font 0.8rem. v1.1 plan moved to
  dev/done; v1.2 in dev/plan-1.2-formatting-keyboard-pwa.md.
- **Blog embedding** (Reading-Since-1990 page, replacing ITables): yes,
  once stable — needs a `?src=<url>` CSV auto-load param, then iframe (or
  copy the three files into the post resources). Future plan.
- **When to "app" it** (Windows default .csv handler): PWA route — web
  manifest with `file_handlers` + service worker, install via Edge, set
  as default in Windows; `launchQueue` delivers the double-clicked file.
  Needs localhost/https serving, so it pairs with the move-to-build
  trigger (first npm dependency / Web Worker / xlsx-Parquet ingest).
  Candidate v1.3.

## 2026-06-11 (evening) — v1.1.0 shipped

- Author committed v1.0 as the baseline; plan-1.0-initial-viewer moved to `dev/done/`.
- v1.1.0 executed from `plan-1.1-fuzzy-and-widths.md` (now in `dev/done/`):
  fzf-style fuzzy global search (score-ordered when unsorted) and tight /
  equal-risk column widths. Widths frozen per load at the full-table
  layout — author explicitly does not want live width changes while
  filtering; re-solve on window resize only.
- Build question: stay zero-build until the first real npm dependency or
  Web-Worker need (xlsx/Parquet ingest, very large files); v1.x polish
  doesn't justify the move.

## 2026-06-11 (later still) — v1.0 verdict and v1.1 ideas

- v1.0 verdict: fantastic, just what was wanted.
- v1.1 designed (`dev/done/plan-1.1-fuzzy-and-widths.md`, awaiting go-ahead): fzf-style fuzzy
  matching in the global search (scored subsequence, fzf extended syntax
  subset), and tight columns by default with "equal-risk VaR" width
  allocation when the table is wider than the screen — every column
  truncates with equal probability; low-sd columns show fully.
- The width-allocation ↔ capital-allocation connection is a paper idea —
  logged in `../TODO.md` (new cross-project ideas file).
- Author bio added to CLAUDE.md and claude-generic.md: PhD in math,
  actuary, geeky — lead with the mathematical framing.

## 2026-06-11 (later) — clarifications

- Zero-build is not a requirement: a Vite/npm SPA (like aggregate_api/web)
  is fine, and the app could be served from one of Steve's web servers —
  but local to his machine is preferred. v1.0 stays zero-build; move to
  Vite only when a real dependency (virtual scroll, Excel/Parquet) earns it.
- gummage corrected: "is or would be perfection" (Chandler: "gum would be
  perfection") — praise, not housekeeping.

## 2026-06-11 — project start, v1.0.0

- Motivation: no existing CSV viewer is acceptable; a vanilla JS/HTML SPA
  is easy to knock out and fully controllable.
- v1.0 requirements: ingest via open/paste/drag box (modeled on the
  archivum `/ingest` page), filtering like the ITables table on the
  Reading-Since-1990 blog post, column sorting, sensible number formats,
  date awareness, numbers right / text left, autosizing columns.
- Built as three files — `index.html`, `app.js`, `styles.css` — no build
  step, no dependencies (Bootstrap via CDN for looks only). Hand-rolled
  RFC 4180 parser with delimiter sniffing; strict all-or-nothing column
  type inference.
- Plan lives in `dev/plan-viewer.md`; stays out of `dev/done/` until the
  author says so. We will iterate. Author handles all git commits.
- Process updates this session (also backfilled to `claude-generic.md`):
  descriptive plan names (`plan-<desc>.md`, not numbered); every project
  keeps a `human-hints.md`; `UV_LINK_MODE=copy` only needed on the T:
  drive; steve-terminology (SWIM, AQIN, gummage) recorded.
