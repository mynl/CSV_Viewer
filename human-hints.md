# human-hints

Very high-level running summary of discussions and decisions in this
project. Newest first.

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
