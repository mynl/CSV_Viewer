# plan-2.1-worker-restructure — Web Worker + src/ layout (no Vite)

From discussion 2026-06-11. Executes as **2.1.0**.

## 1. Directory restructure (git mv, Vite-shaped)

```
index.html              stays at root — Vite's own convention
favicon.svg             root: must be root-scoped today (no build)
manifest.webmanifest    root: ditto
sw.js                   root: MUST stay at root — service-worker scope
src/
  core.js               shared pure logic (page <script> + worker importScripts)
  app.js                UI: state, rendering, layout, fuzzy search, events
  worker.js             parse + inference off the main thread
dev/                    plans, fixtures, smoke test
```

When Vite arrives: favicon/manifest/sw move to `public/`, the two
`<script>` tags become module imports, `importScripts` becomes a module
worker. Until then everything serves with plain `http.server` and still
opens from `file://` (worker falls back, below).

## 2. What moves into `src/core.js`

All pure data logic, shared by page and worker: `cleanCsvText`, delimiter
sniffing, `parseCSV`, markdown table functions, number/date parsing,
`classifyNumber`, `engFormat`, `inferColumns`, `looksHeaderless`,
`guessHeaders`, plus a new **`processData(text, headerOverride)`** —
the md-vs-csv decision + parse + inference + header guessing, returning
`{headers, rows, cols, headerless}`. Formatting (`formatCell` +
NumberFormat cache), fuzzy search, width layout, and all DOM code stay in
`app.js`.

## 3. Worker

- `src/worker.js`: `importScripts('core.js')`; on message
  `{gen, text, headerOverride}` → `postMessage({gen, result})` or
  `{gen, error}`. Results are plain arrays — structured clone is fine.
- `app.js`: texts ≥ `WORKER_MIN_CHARS` (1 MB) go to a lazily-created
  worker; smaller ones run `processData` synchronously (no worker latency
  on the common case). Status bar shows "parsing <name>…" while the
  worker runs. A request generation counter discards stale replies
  (rapid re-drops, header toggles). `loadText` splits into prepare +
  `installData`.
- **Fallback**: worker creation fails on `file://` (Chrome) → silently
  use the synchronous path. Behavior identical, just blocking.

## 4. Blast radius

`sw.js` shell list + cache regex get `src/` paths; smoke test loads
`core.js` + `app.js` into one vm context; CLAUDE.md architecture table,
README. No behavior changes except: large-file parse no longer freezes
the tab.

*Stays in `dev/` until the author says it is done.*
