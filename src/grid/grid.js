/* csv-grid — the embeddable grid half of csv-viewer. Library entry.
 *
 *     import CsvGrid from 'csv-grid';            // or dist/csv-grid.es.js
 *     const grid = new CsvGrid(elementOrSelector, data, options);
 *
 * data (any one of, all with optional `name` for the status line and
 * optional `headerMode` overriding the construction option):
 *   { csv: string }                  parsed + inferred (worker if large)
 *   { records: [...], columns: [..] } array of objects (columns optional)
 *                                    or array of arrays (columns required);
 *                                    null/undefined/NaN cells become ''
 *   { url: string }                  fetched, then treated as csv
 *
 * options (defaults shown):
 *   globalSearch: true      fzf search box in a grid-generated toolbar
 *   columnFilters: true     per-column filter row
 *   sortable: true          click headers to sort
 *   statusBar: true         row-counts line (true = grid-generated,
 *                           an element = render into the host's element,
 *                           false = none)
 *   expandButtons: true     Expand / Contract pair in the toolbar
 *   align: null             'llrcr…' one of l/r/c per column, overrides
 *                           type defaults (rides the markdown col.align
 *                           plumbing); other characters = keep default
 *   formats: null           per-column format specs, null entry = auto
 *                           rules; subset of Python/d3: [,][.N](f|d|%|e|s)
 *                           plus the named 'year' and 'eng'
 *   widthMode: 'equal-risk' squeeze allocation when the table is wider
 *                           than its container: 'equal-risk' (every column
 *                           truncates with equal probability) or 'coverage'
 *                           (maximize the count of fully-shown cells)
 *   maxRows: null           cap the scroll viewport to ~N rows (vertical
 *                           scroll for the rest); null = unbounded
 *   height: null            raw CSS max-height for the scroll viewport
 *                           (e.g. '400px'); overrides maxRows when set
 *   renderCap: 2048         rows rendered before "show all"
 *   eagerCells: 262144      below this, format + index everything at load
 *   worker: true            parse worker for csv >= ~1 MB; false = always
 *                           synchronous; or an explicit worker URL
 *   headerMode: 'auto'      'auto' | 'first-row' | 'headerless'
 *
 * methods: setData(data) -> Promise (a superseded load never settles;
 * failures reject AND show in the grid), destroy(),
 * export({scope, format, values}) -> string (CSV / markdown of the view or
 * whole table). The viewer app also drives its navbar controls through
 * setGlobalFilter / clearFilters / expand / contract / setWidthMode /
 * applyLayout.
 *
 * Multiple instances per page work: no module-global state, no element
 * ids, no document-level listeners (the transient drag-resize
 * mousemove/mouseup pair excepted). Data logic lives in core.js, pure
 * display logic in util.js, viewer chrome in src/app/app.js.
 */

import { cleanCsvText, processData } from './core.js';
import { parseFormatSpec, parseAlignSpec, formatCell, normalizeRecords,
         parseQuery, termScore, solveWidths, sampleIndices, makeColPredicate,
         cellClass, escapeHtml, toCSV, toMarkdown, CELL_PAD, MIN_COL } from './util.js';

const WORKER_MIN_CHARS = 1000000; // ~1 MB; below this parse synchronously
const WIDTH_SAMPLE = 2048;        // rows sampled per column for width percentiles
const INDEX_CHUNK = 10000;        // rows per chunk when building the search index

function el(tag, cls) {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    return e;
}

export default class CsvGrid {
    constructor(target, data, options = {}) {
        const root = typeof target === 'string' ? document.querySelector(target) : target;
        if (!root) throw new Error('CsvGrid: target element not found.');
        this.root = root;
        this.opts = {
            globalSearch: true, columnFilters: true, sortable: true,
            statusBar: true, expandButtons: true, align: null, formats: null,
            renderCap: 2048, eagerCells: 262144, worker: true,
            headerMode: 'auto', widthMode: 'equal-risk',
            maxRows: null, height: null, ...options,
        };

        this.fileName = '';
        this.headers = [];
        this.rows = [];          // raw string cells
        this.cols = [];          // inference results, parallel to headers
        this.formatted = [];     // per-row display-string cache (lazy for large files)
        this.searchRaw = null;   // concatenated row text (formatted + raw) per row
        this.searchLow = null;   // lower-cased version, for case-insensitive terms
        this.searchReady = false;
        this.indexing = null;    // build progress 0..1 while chunking, else null
        this.loadGen = 0;        // bumped per load; abandons stale parses + index builds
        this.scores = [];        // fuzzy match score per row (current query)
        this.layout = null;      // {arrays, floors} from measureLayout, frozen per load
        this.expandAll = false;  // bypass the squeeze: natural widths + h-scroll (sticky)
        this.manualWidths = new Map();   // col index -> px, set by drag-resize
        this.guessedHeaders = false;
        this.ambiguousDateCols = [];   // date cols defaulted to US m/d/y (see _install)
        this.view = [];          // row indices after filter + sort
        this.sortCol = null;
        this.sortDir = 1;
        this.globalFilter = '';
        this.colFilters = [];
        this.showAll = false;

        this._worker = undefined;   // lazy; null = unavailable -> synchronous
        this._pending = new Map();  // load gen -> {resolve, reject} awaiting the worker

        this._buildScaffold();
        if (data) this.setData(data);
    }

    /* Generate the grid's own DOM inside the root: optional toolbar,
     * scrollable table, render-cap note, error line, status. */
    _buildScaffold() {
        const o = this.opts, root = this.root;
        root.classList.add('csvgrid');
        root.replaceChildren();
        this.els = {};
        if (o.globalSearch || o.expandButtons) {
            const tb = el('div', 'csvgrid-toolbar');
            if (o.globalSearch) {
                const inp = el('input', 'csvgrid-search');
                inp.type = 'text';
                inp.placeholder = "fzf search: term 'exact !not ^pre fix$";
                inp.title = "Space-separated terms AND together. Fuzzy by default; "
                    + "'exact, !exclude, ^prefix, suffix$. Uppercase = case-sensitive.";
                inp.addEventListener('input', () => this.setGlobalFilter(inp.value));
                inp.addEventListener('keydown', e => {
                    if (e.key === 'Escape') {
                        e.preventDefault();
                        inp.value = '';
                        inp.blur();
                        this.setGlobalFilter('');
                    }
                });
                tb.appendChild(inp);
                this.els.search = inp;
            }
            if (o.expandButtons) {
                // separate buttons by design — no mode-flipping toggles
                const ex = el('button', 'csvgrid-btn');
                ex.type = 'button';
                ex.textContent = 'Expand';
                ex.title = 'Expand all columns to their full natural width (table scrolls horizontally)';
                ex.addEventListener('click', () => this.expand());
                const ct = el('button', 'csvgrid-btn');
                ct.type = 'button';
                ct.textContent = 'Contract';
                ct.title = 'Back to fitted widths (equal-risk squeeze); also clears any dragged widths';
                ct.addEventListener('click', () => this.contract());
                tb.append(ex, ct);
            }
            root.appendChild(tb);
        }
        const wrap = el('div', 'csvgrid-scroll');
        const table = el('table', 'csvgrid-table');
        const head = el('thead'), body = el('tbody');
        table.append(head, body);
        wrap.appendChild(table);
        root.appendChild(wrap);
        const capNote = el('div', 'csvgrid-capnote csvgrid-hidden');
        const showAllBtn = el('button', 'csvgrid-btn');
        showAllBtn.type = 'button';
        showAllBtn.addEventListener('click', () => {
            this.showAll = true;
            this.renderBody();
            this.renderStatus();
        });
        capNote.appendChild(showAllBtn);
        root.appendChild(capNote);
        const error = el('div', 'csvgrid-error csvgrid-hidden');
        root.appendChild(error);
        let status = null;
        if (o.statusBar === true) {
            status = el('div', 'csvgrid-status');
            root.appendChild(status);
        } else if (o.statusBar) {
            status = o.statusBar;       // host-supplied element
        }
        Object.assign(this.els, { table, head, body, scroll: wrap, capNote, showAllBtn, error, status });

        // tooltip with the full text, only for cells actually truncated
        table.addEventListener('mouseover', e => {
            const cell = e.target.closest('td, th');
            if (cell && !cell.title && cell.scrollWidth > cell.clientWidth) {
                cell.title = cell.textContent;
            }
        });
    }

    // ------------------------------------------------------------ data in

    /* Resolve any data form, then install. Returns a promise; a load
     * superseded by a newer setData never settles (matches the old
     * stale-reply discard); a failed load rejects AND shows the error in
     * the grid. The rejection is pre-handled so embedders may ignore the
     * promise without unhandled-rejection noise. */
    setData(data) {
        const gen = ++this.loadGen;
        const ret = new Promise((resolve, reject) => {
            this._resolveData(data, gen).then(({ d, name }) => {
                if (gen !== this.loadGen) return;   // superseded
                this._install(d, name);
                resolve();
            }, err => {
                if (gen !== this.loadGen) return;
                this._showError(err.message || String(err));
                reject(err);
            });
        });
        ret.catch(() => {});
        return ret;
    }

    async _resolveData(data, gen) {
        if (!data || typeof data !== 'object') {
            throw new Error('CsvGrid: data must be {csv}, {records[, columns]}, or {url}.');
        }
        this._headerMode = data.headerMode ?? this.opts.headerMode;
        if (data.url !== undefined) {
            const url = String(data.url);
            const name = data.name ?? decodeURIComponent(url.split('/').pop() || url);
            const resp = await fetch(url);
            if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
            return { d: await this._parse(await resp.text(), gen, name), name };
        }
        if (data.csv !== undefined) {
            const name = data.name ?? '';
            return { d: await this._parse(data.csv, gen, name), name };
        }
        if (data.records !== undefined) {
            return { d: normalizeRecords(data.records, data.columns), name: data.name ?? '' };
        }
        throw new Error('CsvGrid: data must be {csv}, {records[, columns]}, or {url}.');
    }

    /* Synchronous processData below ~1 MB (or with worker:false); the
     * parse worker above, with progress in the status line. */
    _parse(text, gen, name) {
        text = cleanCsvText(text);
        if (!text.trim()) throw new Error('No data found.');
        const headerOverride = this._headerMode === 'first-row' ? true
            : this._headerMode === 'headerless' ? false : null;
        const w = (this.opts.worker !== false && text.length >= WORKER_MIN_CHARS)
            ? this._getWorker() : null;
        if (!w) return processData(text, headerOverride);
        this._setStatus(`parsing ${name || 'data'} (${(text.length / 1e6).toFixed(1)} MB)…`);
        return new Promise((resolve, reject) => {
            this._pending.set(gen, { resolve, reject });
            w.postMessage({ gen, text, headerOverride });
        });
    }

    /* Parse worker, created lazily; null = unavailable -> synchronous.
     * The `new Worker(new URL(...), {type:'module'})` literal is the
     * pattern both browsers (dev, served source) and Vite (dist bundles)
     * resolve: Vite compiles the worker into dist and rewrites the URL. */
    _getWorker() {
        if (this._worker === undefined) {
            this._worker = null;
            try {
                const w = typeof this.opts.worker === 'string'
                    ? new Worker(this.opts.worker)
                    : new Worker(new URL('./worker.js', import.meta.url), { type: 'module' });
                w.onmessage = e => {
                    const { gen, result, error } = e.data;
                    const pend = this._pending.get(gen);
                    if (!pend) return;          // stale reply
                    this._pending.delete(gen);
                    if (error) pend.reject(new Error(error));
                    else pend.resolve(result);
                };
                w.onerror = () => {
                    const all = [...this._pending.values()];
                    this._pending.clear();
                    for (const p of all) p.reject(new Error('Background parse failed.'));
                };
                this._worker = w;
            } catch { /* fall through to synchronous */ }
        }
        return this._worker;
    }

    /* Install a processData-shaped result and (re)render. Width
     * application no-ops while the root is hidden (clientWidth 0) — hosts
     * that reveal the grid afterwards call applyLayout() then. */
    _install(d, name) {
        const { rows, cols } = d;
        if (this.opts.align) {
            const spec = parseAlignSpec(this.opts.align);
            cols.forEach((col, c) => { if (spec[c]) col.align = spec[c]; });
        }
        if (this.opts.formats) {
            cols.forEach((col, c) => { col.fmt = parseFormatSpec(this.opts.formats[c]); });
        }
        this.fileName = name || '';
        this.guessedHeaders = d.headerless;
        // date columns whose all-numeric order was unknowable (defaulted to
        // US m/d/y) — the chrome surfaces this as a note; embedders may read it
        this.ambiguousDateCols = cols.filter(c => c.ambiguousOrder).map(c => c.name);
        this.headers = d.headers;
        this.rows = rows;
        this.cols = cols;
        this.formatted = new Array(rows.length);
        this.searchRaw = null;
        this.searchLow = null;
        this.searchReady = false;
        this.indexing = null;
        if (rows.length * cols.length <= this.opts.eagerCells) {
            // small file: prefill everything, exactly the pre-2.0 behavior
            for (let r = 0; r < rows.length; r++) this.getFormattedRow(r);
            this.searchRaw = this.formatted.map(
                (frow, r) => frow.join(' ') + ' ' + rows[r].join(' '));
            this.searchLow = this.searchRaw.map(s => s.toLowerCase());
            this.searchReady = true;
        }
        this.sortCol = null;
        this.sortDir = 1;
        this.globalFilter = '';
        this.colFilters = new Array(cols.length).fill('');
        this.manualWidths = new Map();
        this.showAll = false;
        if (this.els.search) this.els.search.value = '';
        this.els.error.classList.add('csvgrid-hidden');
        this.renderHead();
        this.layout = this.measureLayout();   // frozen for this load
        this.applyLayout();
        this.refresh();
        this._applyHeight();
    }

    /* Bound the scroll viewport's height (vertical scroll for the rest,
     * sticky header stays). `height` is a raw CSS max-height; `maxRows`
     * caps it to ~N data rows, measured from the just-rendered table.
     * No-op (unbounded) when neither is set — the host may still cap it. */
    _applyHeight() {
        const o = this.opts;
        if (o.height) { this.els.scroll.style.maxHeight = o.height; return; }
        if (o.maxRows && this.els.body.rows.length) {
            const headH = this.els.head.offsetHeight;
            const rowH = this.els.body.rows[0].offsetHeight;
            this.els.scroll.style.maxHeight = Math.ceil(headH + rowH * o.maxRows + 2) + 'px';
        }
    }

    _showError(msg) {
        this.els.error.textContent = msg;
        this.els.error.classList.remove('csvgrid-hidden');
    }

    _setStatus(text) {
        if (this.els.status) this.els.status.textContent = text;
    }

    destroy() {
        this.loadGen++;             // abandon pending parses and index builds
        this._pending.clear();
        if (this._worker) { this._worker.terminate(); this._worker = null; }
        this.root.classList.remove('csvgrid');
        this.root.replaceChildren();
    }

    // ----------------------------------------------------- public controls

    setGlobalFilter(q) {
        this.globalFilter = q;
        this.refresh();
    }

    clearFilters() {
        this.globalFilter = '';
        this.colFilters = this.colFilters.map(() => '');
        if (this.els.search) this.els.search.value = '';
        this.renderHead();
        this.refresh();
    }

    expand() {
        this.expandAll = true;
        this.applyLayout();
    }

    contract() {
        this.expandAll = false;
        this.manualWidths.clear();
        this.applyLayout();
    }

    /* Serialize to a string for copy/save. Options:
     *   scope:  'view' (current filter + sort) | 'all' (every row, original
     *           file order, unfiltered — predictable, "minimum surprises")
     *   format: 'csv' (RFC 4180) | 'md' (markdown pipe table)
     *   values: 'raw' (cells as loaded) | 'formatted' (as displayed)
     * `formatted` is honored only when the chosen scope's row count is
     * within renderCap (formatting a quarter-million cells on a click would
     * stall); above that it transparently falls back to raw. Returns the
     * string; the caller decides the sink (clipboard / file) and any BOM. */
    export({ scope = 'view', format = 'csv', values = 'raw' } = {}) {
        const idx = scope === 'all'
            ? this.rows.map((_, i) => i)        // original order, unfiltered
            : this.view;                        // current filter + sort
        const formatted = values === 'formatted' && idx.length <= this.opts.renderCap;
        const rows2d = idx.map(r => formatted
            ? this.getFormattedRow(r)
            : this.cols.map((_, c) => this.rows[r][c] ?? ''));
        if (format === 'md') {
            const aligns = this.cols.map(col => col.align
                || (col.type === 'number' ? 'right' : col.type === 'date' ? 'center' : 'left'));
            return toMarkdown(this.headers, rows2d, aligns);
        }
        return toCSV(this.headers, rows2d);
    }

    /* Switch the squeeze allocation method and re-solve. Same measured
     * layout, no reload — only the budget allocation changes. */
    setWidthMode(mode) {
        this.opts.widthMode = mode === 'coverage' ? 'coverage' : 'equal-risk';
        this.applyLayout();
    }

    // ------------------------------------------------------------- layout

    /* Measure formatted cell and header widths with a canvas in the table's
     * font. Returns {arrays, floors}: per-column sorted cell widths and
     * minimum (header-driven) widths. */
    measureLayout() {
        // one scratch canvas shared by all instances
        const canvas = CsvGrid._canvas || (CsvGrid._canvas = document.createElement('canvas'));
        const ctx = canvas.getContext('2d');
        const cs = getComputedStyle(this.els.table);
        const font = `${cs.fontSize} ${cs.fontFamily}`;
        // sampled, not exhaustive: quantiles from ~2K rows per column (2.0.0)
        const sample = sampleIndices(this.rows.length, WIDTH_SAMPLE);
        const arrays = [], floors = [];
        for (let c = 0; c < this.cols.length; c++) {
            ctx.font = `bold ${font}`;
            // 14px ≈ the sort-arrow slot in the header
            floors.push(Math.max(MIN_COL,
                Math.ceil(ctx.measureText(this.cols[c].name).width) + 14 + CELL_PAD));
            ctx.font = font;
            const w = [];
            for (const r of sample) {
                const text = this.getFormattedRow(r)[c];
                if (text !== '') w.push(Math.ceil(ctx.measureText(text).width) + CELL_PAD);
            }
            w.sort((a, b) => a - b);
            arrays.push(w);
        }
        return { arrays, floors };
    }

    /* Drag-resize: a handle on each header's right edge. Drag sets a manual
     * width override (kept across re-solves until the next file load);
     * double-click fits the column to its content (Excel-style). */
    startColResize(e, c) {
        e.preventDefault();
        e.stopPropagation();
        const table = this.els.table;
        const col = table.querySelectorAll('colgroup col')[c];
        if (!col) return;
        const startX = e.clientX;
        const startW = parseFloat(col.style.width);
        document.body.classList.add('csvgrid-resizing');
        const setTableWidth = () => {
            let sum = 0;
            table.querySelectorAll('colgroup col').forEach(k => { sum += parseFloat(k.style.width); });
            table.style.width = sum + 'px';
        };
        const move = ev => {
            const w = Math.max(24, Math.round(startW + ev.clientX - startX));
            this.manualWidths.set(c, w);
            col.style.width = w + 'px';
            setTableWidth();
        };
        const up = () => {
            document.body.classList.remove('csvgrid-resizing');
            document.removeEventListener('mousemove', move);
            document.removeEventListener('mouseup', up);
        };
        document.addEventListener('mousemove', move);
        document.addEventListener('mouseup', up);
    }

    fitColumn(c) {
        const { arrays, floors } = this.layout;
        const natural = Math.max(floors[c], arrays[c].length ? arrays[c][arrays[c].length - 1] : 0);
        this.manualWidths.set(c, natural);
        this.applyLayout();
    }

    /* Solve against the current viewport and pin widths via <colgroup> +
     * table-layout: fixed. */
    applyLayout() {
        if (!this.layout) return;
        const table = this.els.table;
        const avail = this.expandAll ? Infinity : table.parentElement.clientWidth;
        if (!avail) return;
        const widths = solveWidths(this.layout.arrays, this.layout.floors, avail, this.opts.widthMode);
        for (const [c, w] of this.manualWidths) if (c < widths.length) widths[c] = w;
        let cg = table.querySelector('colgroup');
        if (cg) cg.remove();
        cg = document.createElement('colgroup');
        for (const w of widths) {
            const col = document.createElement('col');
            col.style.width = w + 'px';
            cg.appendChild(col);
        }
        table.prepend(cg);
        table.style.tableLayout = 'fixed';
        table.style.width = widths.reduce((a, b) => a + b, 0) + 'px';
    }

    // ----------------------------------------------- lazy format / index

    /* Format a row on demand and cache it. Small files are prefilled at
     * load; large files only ever format what rendering, width-sampling, or
     * the search index actually touch. */
    getFormattedRow(r) {
        let f = this.formatted[r];
        if (!f) {
            f = this.cols.map((col, c) => formatCell(this.rows[r][c], col, r));
            this.formatted[r] = f;
        }
        return f;
    }

    /* Build the global-search index (formatted + raw text per row) in
     * chunks, yielding to the UI between chunks; progress shows in the
     * status line. The pending query applies automatically on completion. A
     * stale build is abandoned if a new file loads (loadGen). */
    buildSearchIndexChunked() {
        const gen = this.loadGen;
        const n = this.rows.length;
        const raw = new Array(n), low = new Array(n);
        let r = 0;
        this.indexing = 0;
        const step = () => {
            if (gen !== this.loadGen) return;   // a new file arrived; abandon
            const end = Math.min(n, r + INDEX_CHUNK);
            for (; r < end; r++) {
                const s = this.getFormattedRow(r).join(' ') + ' ' + this.rows[r].join(' ');
                raw[r] = s;
                low[r] = s.toLowerCase();
            }
            if (r < n) {
                this.indexing = r / n;
                this.renderStatus();
                setTimeout(step, 0);
            } else {
                this.searchRaw = raw;
                this.searchLow = low;
                this.searchReady = true;
                this.indexing = null;
                this.refresh();
            }
        };
        step();
    }

    // ------------------------------------------------------ filter + sort

    rebuildView() {
        const { rows, cols } = this;
        let terms = parseQuery(this.globalFilter);
        // global search needs the index; kick off the chunked build and leave
        // the global term unapplied until it lands (column filters work now)
        if (terms.length && !this.searchReady) {
            if (this.indexing === null) this.buildSearchIndexChunked();
            terms = [];
        }
        const hasFuzzy = terms.some(t => t.kind === 'fuzzy' && !t.negate);
        const preds = this.colFilters.map((f, c) => makeColPredicate(f || '', cols[c]));
        const active = preds.some(p => p) || terms.length;

        let idx = [];
        this.scores = [];
        for (let r = 0; r < rows.length; r++) {
            let score = 0;
            if (active) {
                let ok = true;
                for (const t of terms) {
                    const s = termScore(t, this.searchLow[r], this.searchRaw[r]);
                    if (s < 0) { ok = false; break; }
                    score += s;
                }
                if (ok) {
                    for (let c = 0; c < preds.length; c++) {
                        if (preds[c] && !preds[c]((rows[r][c] ?? ''), r)) { ok = false; break; }
                    }
                }
                if (!ok) continue;
            }
            this.scores[r] = score;
            idx.push(r);
        }

        const sc = this.sortCol;
        if (sc === null && hasFuzzy) {
            // no explicit sort: best fuzzy matches first, original order on ties
            idx.sort((a, b) => (this.scores[b] - this.scores[a]) || (a - b));
        } else if (sc !== null) {
            const col = this.cols[sc];
            const dir = this.sortDir;
            if (col.type === 'text') {
                const coll = new Intl.Collator('en', { sensitivity: 'base', numeric: true });
                idx.sort((a, b) => {
                    const x = (this.rows[a][sc] ?? '').trim();
                    const y = (this.rows[b][sc] ?? '').trim();
                    if (x === '' || y === '') return x === y ? 0 : (x === '' ? 1 : -1);
                    return dir * coll.compare(x, y);
                });
            } else {
                idx.sort((a, b) => {
                    const x = col.values[a], y = col.values[b];
                    if (x === null || y === null) return x === y ? 0 : (x === null ? 1 : -1);
                    return dir * (x - y);
                });
            }
        }
        this.view = idx;
    }

    // ---------------------------------------------------------- rendering

    renderHead() {
        const { cols } = this;
        const head = this.els.head;
        head.innerHTML = '';

        const hr = document.createElement('tr');
        cols.forEach((col, c) => {
            const th = document.createElement('th');
            th.className = cellClass(col);
            if (this.opts.sortable) {
                const arrow = this.sortCol === c ? (this.sortDir === 1 ? '▲' : '▼') : '';
                th.innerHTML = `<span class="sort-arrow">${arrow}</span>${escapeHtml(col.name)}`;
                th.title = `${col.name} (${col.type}) — click to sort`;
                th.addEventListener('click', () => this.onSort(c));
            } else {
                th.innerHTML = `<span class="sort-arrow"></span>${escapeHtml(col.name)}`;
                th.title = `${col.name} (${col.type})`;
                th.classList.add('csvgrid-nosort');
            }
            const grip = document.createElement('span');
            grip.className = 'col-resizer';
            grip.title = 'Drag to resize — double-click to fit content';
            grip.addEventListener('mousedown', e => this.startColResize(e, c));
            grip.addEventListener('dblclick', e => { e.stopPropagation(); this.fitColumn(c); });
            grip.addEventListener('click', e => e.stopPropagation());
            th.appendChild(grip);
            hr.appendChild(th);
        });
        head.appendChild(hr);

        if (!this.opts.columnFilters) return;
        const fr = document.createElement('tr');
        fr.className = 'filter-row';
        cols.forEach((col, c) => {
            const th = document.createElement('th');
            const inp = document.createElement('input');
            inp.type = 'text';
            inp.className = 'csvgrid-filter';
            inp.placeholder = col.type === 'text' ? 'filter' : 'filter, >, .. ';
            inp.value = this.colFilters[c] || '';
            inp.addEventListener('input', () => {
                this.colFilters[c] = inp.value;
                inp.classList.toggle('active-filter', inp.value.trim() !== '');
                this.refresh();
            });
            inp.addEventListener('keydown', e => {
                if (e.key === 'Escape') {
                    e.preventDefault();
                    inp.value = '';
                    this.colFilters[c] = '';
                    inp.classList.remove('active-filter');
                    inp.blur();
                    this.refresh();
                }
            });
            th.appendChild(inp);
            fr.appendChild(th);
        });
        head.appendChild(fr);
    }

    renderBody() {
        const { cols, view } = this;
        const cap = this.showAll ? view.length : Math.min(view.length, this.opts.renderCap);
        const parts = [];
        for (let i = 0; i < cap; i++) {
            const r = view[i];
            const frow = this.getFormattedRow(r);
            const cells = cols.map((col, c) => {
                const text = frow[c];
                if (text === '') return `<td class="${cellClass(col)} blank">·</td>`;
                return `<td class="${cellClass(col)}">${escapeHtml(text)}</td>`;
            });
            parts.push(`<tr>${cells.join('')}</tr>`);
        }
        this.els.body.innerHTML = parts.join('');

        const note = this.els.capNote;
        if (view.length > cap) {
            note.classList.remove('csvgrid-hidden');
            this.els.showAllBtn.textContent =
                `Showing first ${cap.toLocaleString()} of ${view.length.toLocaleString()} rows — show all`;
        } else {
            note.classList.add('csvgrid-hidden');
        }
    }

    renderStatus() {
        if (!this.els.status) return;
        const fmt = n => n.toLocaleString();
        const total = this.rows.length;
        const shown = this.view.length;
        const cap = this.showAll ? shown : Math.min(shown, this.opts.renderCap);
        let s = this.fileName ? this.fileName + ' — ' : '';
        s += shown === total ? `${fmt(total)} rows` : `${fmt(shown)} of ${fmt(total)} rows`;
        s += ` × ${this.cols.length} cols`;
        if (cap < shown) s += ` — showing rows 1–${fmt(cap)}`;
        if (this.guessedHeaders) s += ' (headers guessed)';
        if (this.indexing !== null) s += ` — indexing search ${Math.round(this.indexing * 100)}%`;
        this.els.status.textContent = s;
    }

    refresh() {
        this.rebuildView();
        this.renderBody();
        this.renderStatus();
    }

    // -------------------------------------------------------------- events

    onSort(c) {
        if (this.sortCol === c) {
            if (this.sortDir === 1) this.sortDir = -1;
            else { this.sortCol = null; this.sortDir = 1; }   // third click: reset
        } else {
            this.sortCol = c; this.sortDir = 1;
        }
        this.renderHead();
        this.refresh();
    }
}
