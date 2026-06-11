# human-hints

Very high-level running summary of discussions and decisions in this
project. Newest first.

## 2026-06-11 (later still) — v1.0 verdict and v1.1 ideas

- v1.0 verdict: fantastic, just what was wanted.
- v1.1 designed (`dev/plan-punchup.md`, awaiting go-ahead): fzf-style fuzzy
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
