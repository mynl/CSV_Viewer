# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with
code in this repository.

## Project Overview

`csv-viewer` is a zero-build, single-page CSV viewer in vanilla JS/HTML —
born of the author finding no existing CSV viewer in any way acceptable.
Open `index.html` in a browser: drag/drop, browse, or paste CSV data and get
a sortable, filterable, properly formatted table. Type-aware columns
(number / date / text), thousands separators, dates normalized to ISO,
numbers right-aligned, autosized columns. No framework, no build step, no
server; Bootstrap 5 via CDN for styling only. Look and feel follows the
author's archivum apps.

A private side project, iterated at a relaxed pace.

Author: Stephen J. Mildenhall — PhD in math, actuary, geeky. Lead with the
mathematical framing; quantitative formulations (optimization, probability,
risk measures) are welcome and often the intended design language.

## Working with the author

These rules apply in every project — follow them without being re-asked.

- **The author handles all git commits. Do not commit.** To check status, read
  the git log; if an expected commit is missing, mention it.
- **Diagnose / design / propose before editing source or tests.** Don't change
  code until told to proceed ("go ahead"). "Can you see the issue?" means
  explain, not fix.
- Environment is **PowerShell on Windows**. No `awk`/`sed`/`head`/`tail` (even
  via the Bash tool). Use `rg` + the Read/Edit/Write tools.
- Prefer explicit, documented recipes over magic / auto-install behavior.
- Keep rendered output tight — no gratuitous blank lines in blocks.
- US spelling throughout (prose, docstrings, comments, identifiers).
- **Keep `human-hints.md` current** — a very high-level summary of what we
  discuss and decide, newest first. Update it at the close of each working
  session.
- Periodically remind the author to stop biting his tongue.

## Steve-terminology

- **SWIM** — "see what I mean": you have enough context; fill remaining gaps
  sensibly rather than asking.
- **AQIN** — "ask questions if needed": on genuine ambiguity, ask rather than
  guess.
- **gummage** — is or would be perfection. From Chandler Bing, stuck in a
  vestibule with a pretty woman during a power outage, offered a stick of gum:
  "gum would be perfection." High praise: "that's gummage" = exactly right.

## Commands

No build step, no dependencies, no package manager. (No Python here; if `uv`
is ever needed, this repo is on C: so default hardlink mode is fine —
`UV_LINK_MODE=copy` is only for the T: drive.)

**Run the app:** open `index.html` in a browser, or serve locally:
```
python -m http.server 8080
```

**Run the logic smoke test** (parser, sniffing, inference, formatting,
filters — needs Node):
```
node dev/smoke-test.mjs
```

**Sample data** for manual testing: `dev/sample.csv` (quoted fields, commas
in values, currency, paren negatives, ISO + US dates, blanks).

## Architecture

| File | Role |
|---|---|
| `index.html` | page shell: ingest view (drop zone + paste box) and table view |
| `app.js` | all logic — parser, type inference, formatting, filter/sort, render |
| `styles.css` | drop zone, sticky header, alignment classes, column width caps |
| `dev/smoke-test.mjs` | Node smoke test over the pure-logic half of `app.js` |

Pipeline in `app.js`: ingest → `parseCSV` (RFC 4180, `sniffDelimiter`) →
`inferColumns` (strict all-or-nothing: number / date / text) → `state` →
`rebuildView` (global + per-column filters, type-aware sort) → render.
Version lives in `const VERSION` in `app.js`, shown in the footer.

## Documentation and code style

Vanilla JS, no framework idioms. Comment the *why* on non-obvious logic
(parsing edge cases, inference rules). Keep `app.js` self-contained and
dependency-free — no Papa Parse, no DataTables; full control over formats
and alignment is the point of the project.

## Release & housekeeping workflow

These are standing rules — follow them without being re-asked.

- **Work proceeds from plan docs**: `dev/plan-<desc>.md` (descriptive names,
  not numbered). Move a plan to `dev/done/` **only when the author says it is
  done** — not when the code lands.
- **Every plan-based code change bumps the version** (`VERSION` in `app.js`).
  Pure tidying does not.
- **Keep `CHANGELOG.md` current** — each version bump adds a `## <version>`
  section at the close of the iteration.
- **`README.md`** is the stable front page; touch it only when that material
  changes.
- **Keep `human-hints.md` current** (see Working with the author).
