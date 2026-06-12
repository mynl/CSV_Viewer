/* csv-grid — the embeddable grid half of csv-viewer.
 *
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
 *   renderCap: 2000         rows rendered before "show all"
 *   eagerCells: 200000      below this, format + index everything at load
 *   worker: true            parse worker for csv >= ~1 MB; false = always
 *                           synchronous; or an explicit worker URL
 *   headerMode: 'auto'      'auto' | 'first-row' | 'headerless'
 *
 * methods: setData(data) -> Promise (a superseded load never settles;
 * failures reject AND show in the grid), destroy(). The viewer app also
 * drives its navbar controls through setGlobalFilter / clearFilters /
 * expand / contract / applyLayout.
 *
 * Multiple instances per page work: no module-global state, no element
 * ids, no document-level listeners (the transient drag-resize
 * mousemove/mouseup pair excepted). Pure data logic lives in core.js;
 * viewer chrome in src/app/app.js.
 */

'use strict';

const WORKER_MIN_CHARS = 1000000; // ~1 MB; below this parse synchronously
const WIDTH_SAMPLE = 2000;        // rows sampled per column for width percentiles
const INDEX_CHUNK = 10000;        // rows per chunk when building the search index

/* Captured at load so the grid can find worker.js next to itself when a
 * page loads these as plain script tags (no bundler). */
const GRID_BASE = (typeof document !== 'undefined' && document.currentScript && document.currentScript.src)
    ? new URL('.', document.currentScript.src).href : '';

// ------------------------------------------------------------- formatting

/* Intl.NumberFormat construction is ~100x the cost of a format call —
 * cache one formatter per decimal count. */
const NF_CACHE = new Map();
function numberFormatter(dec) {
    let nf = NF_CACHE.get(dec);
    if (!nf) {
        nf = new Intl.NumberFormat('en-US',
            { minimumFractionDigits: dec, maximumFractionDigits: dec });
        NF_CACHE.set(dec, nf);
    }
    return nf;
}

/* Parse a format spec into {kind, comma, dec}. Subset of the Python/d3
 * mini-language: optional ',' (thousands), optional '.N' (decimals), one
 * of f (fixed) d (integer) % (x100, percent) e (scientific) s (SI
 * suffix), plus the named specs 'year' and 'eng'. null/'' = auto rules.
 * Date format specs are explicitly out of scope (display stays ISO). */
function parseFormatSpec(spec) {
    if (spec === null || spec === undefined || spec === '') return null;
    if (spec === 'year' || spec === 'eng') return { kind: spec };
    const m = /^(,)?(?:\.(\d+))?([fd%es])$/.exec(spec);
    if (!m) throw new Error(`CsvGrid: unrecognized format spec '${spec}'`);
    return { kind: m[3], comma: !!m[1], dec: m[2] === undefined ? null : +m[2] };
}

const SI_TIERS = [[1e12, 'T'], [1e9, 'G'], [1e6, 'M'], [1e3, 'k'],
                  [1, ''], [1e-3, 'm'], [1e-6, 'µ'], [1e-9, 'n']];

/* Apply a parsed spec to a numeric value. Defaults when .N is omitted:
 * f -> 2, % -> 0, e -> 2, s -> engFormat's 3 significant digits. */
function formatWithSpec(v, f) {
    switch (f.kind) {
        case 'year': return String(v);
        case 'eng':  return engFormat(v);
        case 'd': {
            const r = Math.round(v);
            return f.comma ? numberFormatter(0).format(r) : String(r);
        }
        case 'f': {
            const dec = f.dec ?? 2;
            return f.comma ? numberFormatter(dec).format(v) : v.toFixed(dec);
        }
        case '%': {
            const dec = f.dec ?? 0, x = v * 100;
            return (f.comma ? numberFormatter(dec).format(x) : x.toFixed(dec)) + '%';
        }
        case 'e': return v.toExponential(f.dec ?? 2);
        case 's': {
            if (f.dec === null || f.dec === undefined) return engFormat(v);
            if (v === 0) return (0).toFixed(f.dec);
            const a = Math.abs(v);
            for (const [m, suf] of SI_TIERS) {
                if (a >= m) return (v / m).toFixed(f.dec) + suf;
            }
            return (v / 1e-9).toFixed(f.dec) + 'n';
        }
    }
}

/* 'llrcr' -> ['left','left','right','center','right']; any other
 * character keeps the column's type-default alignment. */
function parseAlignSpec(s) {
    return [...s].map(ch => ({ l: 'left', r: 'right', c: 'center' }[ch] ?? null));
}

function formatCell(raw, col, r) {
    raw = (raw ?? '').trim();
    if (raw === '') return '';
    if (col.type === 'number') {
        const v = col.values[r];
        if (v === null) return raw;
        if (col.fmt) return formatWithSpec(v, col.fmt);   // explicit spec wins
        if (col.format === 'year') return String(v);
        if (col.format === 'eng') return engFormat(v);
        return numberFormatter(col.dec).format(v);
    }
    if (col.type === 'date') {
        const t = col.values[r];
        if (t === null) return raw;
        const d = new Date(t);
        const pad = x => String(x).padStart(2, '0');
        let s = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
        if (col.hasTime) s += ` ${pad(d.getHours())}:${pad(d.getMinutes())}`;
        return s;
    }
    return raw;
}

// ------------------------------------------------------------ records data

/* Normalize {records, columns} data to a processData-shaped result:
 * array-of-objects (columns = key subset/order, default first record's
 * keys) or array-of-arrays (columns required). Cells stringify;
 * null/undefined/NaN -> ''. Types are re-inferred from the strings, same
 * as a CSV load. */
function normalizeRecords(records, columns) {
    if (!Array.isArray(records)) throw new Error('CsvGrid: records must be an array.');
    const toStr = v => (v === null || v === undefined
        || (typeof v === 'number' && Number.isNaN(v))) ? '' : String(v);
    let headers, rows;
    if (records.length && Array.isArray(records[0])) {
        if (!columns) throw new Error('CsvGrid: columns are required with array-of-arrays records.');
        headers = columns.map(String);
        rows = records.map(rec => headers.map((_, c) => toStr(rec[c])));
    } else {
        headers = (columns ?? Object.keys(records[0] ?? {})).map(String);
        rows = records.map(rec => headers.map(h => toStr(rec[h])));
    }
    const cols = inferColumns(headers, rows);
    return { headers, rows, cols, headerless: false };
}

// ----------------------------------------------------------- fuzzy search

/* fzf-style global search. Query = space-separated terms, ANDed.
 * Term prefixes/suffixes (a subset of fzf extended syntax):
 *   abc     fuzzy subsequence match (scored)
 *   'abc    exact substring
 *   !abc    exclude rows containing abc (exact substring)
 *   ^abc    row text starts with abc;  abc$  row text ends with abc
 * Smart case: a term containing an uppercase letter matches case-
 * sensitively; otherwise case-insensitive. */
function parseQuery(q) {
    const terms = [];
    for (let tok of q.trim().split(/\s+/)) {
        if (!tok) continue;
        const t = { kind: 'fuzzy', negate: false };
        if (tok.startsWith('!')) { t.negate = true; t.kind = 'exact'; tok = tok.slice(1); }
        if (tok.startsWith("'")) { t.kind = 'exact'; tok = tok.slice(1); }
        if (tok.startsWith('^')) { t.kind = 'prefix'; tok = tok.slice(1); }
        if (tok.endsWith('$'))   { t.kind = t.kind === 'prefix' ? 'exact' : 'suffix'; tok = tok.slice(0, -1); }
        if (!tok) continue;
        t.cs = /[A-Z]/.test(tok);
        t.str = t.cs ? tok : tok.toLowerCase();
        terms.push(t);
    }
    return terms;
}

const BOUNDARY_RE = /[\s_\-\/\\.,:;()[\]{}"']/;

/* fzf-v1-style scored subsequence match. Forward pass finds the first
 * subsequence match; backward pass tightens the window; bonuses for word-
 * boundary and consecutive matches, penalties for window slack and a late
 * start. Returns a score >= 0, or -1 for no match. O(hay length). */
function fuzzyScore(needle, hay) {
    const n = hay.length, m = needle.length;
    if (m === 0) return 0;
    if (m > n) return -1;
    let j = 0, end = -1;
    for (let i = 0; i < n; i++) {
        if (hay[i] === needle[j]) { j++; if (j === m) { end = i; break; } }
    }
    if (end < 0) return -1;
    j = m - 1;
    let start = end;
    for (let i = end; i >= 0; i--) {
        if (hay[i] === needle[j]) { start = i; j--; if (j < 0) break; }
    }
    let score = 100 - 3 * (end - start + 1 - m) - Math.min(start, 20);
    j = 0;
    let prevMatched = false;
    for (let i = start; i <= end && j < m; i++) {
        if (hay[i] === needle[j]) {
            if (i === 0 || BOUNDARY_RE.test(hay[i - 1])) score += 8;
            if (prevMatched) score += 4;
            prevMatched = true; j++;
        } else prevMatched = false;
    }
    return score;
}

/* Evaluate one term against a row's concatenated text. Returns -1 for no
 * match, else the term's score contribution (0 for non-fuzzy kinds). */
function termScore(t, rowLow, rowRaw) {
    const hay = t.cs ? rowRaw : rowLow;
    let ok, score = 0;
    switch (t.kind) {
        case 'exact':  ok = hay.includes(t.str); break;
        case 'prefix': ok = hay.startsWith(t.str); break;
        case 'suffix': ok = hay.endsWith(t.str); break;
        default: {
            const s = fuzzyScore(t.str, hay);
            ok = s >= 0; score = s;
        }
    }
    if (t.negate) ok = !ok;
    return ok ? score : -1;
}

// ----------------------------------------------------- column width layout

/* Widths are measured once per load from the FULL table and frozen — they
 * deliberately do not respond to filtering (distracting), only to window
 * resize (the host's job: call applyLayout()). */

const CELL_PAD = 18;     // padding + border + safety, px
const MIN_COL = 50;      // absolute floor, px

/* Allocate column widths into `avail` px. Tight (every cell fully visible)
 * if it fits; otherwise the equal-risk VaR rule: bisect for the single
 * percentile q such that the per-column q-th percentile widths (floored)
 * sum to avail — every column truncates with the same probability 1 - q.
 * `arrays` must be sorted ascending. */
function solveWidths(arrays, floors, avail) {
    const pct = (s, q) => s.length ? s[Math.floor(q * (s.length - 1))] : 0;
    const widthsAt = q => arrays.map((s, j) => Math.max(floors[j], pct(s, q)));
    const total = w => w.reduce((a, b) => a + b, 0);

    const natural = widthsAt(1);
    if (total(natural) <= avail) return natural;
    if (total(widthsAt(0)) >= avail) return widthsAt(0);   // floors + scroll

    let lo = 0, hi = 1;                  // f(lo) <= avail < f(hi); f monotone
    for (let k = 0; k < 32; k++) {
        const mid = (lo + hi) / 2;
        if (total(widthsAt(mid)) <= avail) lo = mid; else hi = mid;
    }
    return widthsAt(lo);
}

/* Deterministic stride sample of k indices from 0..n-1 (all of them when
 * n <= k). Quantiles from the sample stand in for the full distribution —
 * the equal-risk width allocation is a VaR estimate, and ~2,000 points
 * pin a quantile curve down fine. */
function sampleIndices(n, k) {
    if (n <= k) return Array.from({ length: n }, (_, i) => i);
    const out = new Array(k);
    const stride = n / k;
    for (let i = 0; i < k; i++) out[i] = Math.floor(i * stride);
    return out;
}

// ------------------------------------------------------------- filtering

/* Build a predicate from a per-column filter string. Number/date columns
 * support >x >=x <x <=x =x and a..b ranges; otherwise substring match. */
function makeColPredicate(filter, col) {
    const f = filter.trim();
    if (!f) return null;
    if (col.type === 'number' || col.type === 'date') {
        const parseVal = col.type === 'number'
            ? s => { const p = parseNumber(s); return p ? p.v : NaN; }
            : s => { const p = parseDate(s); return p ? p.t : NaN; };
        let m = /^(>=|<=|>|<|=)\s*(.+)$/.exec(f);
        if (m) {
            const v = parseVal(m[2]);
            if (!isNaN(v)) {
                const op = m[1];
                return (raw, r) => {
                    const x = col.values[r];
                    if (x === null) return false;
                    switch (op) {
                        case '>':  return x > v;
                        case '>=': return x >= v;
                        case '<':  return x < v;
                        case '<=': return x <= v;
                        default:   return x === v;
                    }
                };
            }
        }
        m = /^(.+?)\.\.(.+)$/.exec(f);
        if (m) {
            const lo = parseVal(m[1]), hi = parseVal(m[2]);
            if (!isNaN(lo) && !isNaN(hi)) {
                return (raw, r) => {
                    const x = col.values[r];
                    return x !== null && x >= lo && x <= hi;
                };
            }
        }
    }
    const needle = f.toLowerCase();
    return (raw, r) => raw.toLowerCase().includes(needle);
}

// ------------------------------------------------------ rendering helpers

/* Type-based alignment class, overridden by an align spec or a markdown
 * alignment row. Scoped by .csvgrid-table in grid.css. */
function cellClass(col) {
    return col.align ? `col-${col.type} align-${col.align}` : `col-${col.type}`;
}

function escapeHtml(s) {
    return s.replace(/&/g, '&amp;').replace(/</g, '&lt;')
            .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function el(tag, cls) {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    return e;
}

// ----------------------------------------------------------------- CsvGrid

class CsvGrid {
    constructor(target, data, options = {}) {
        const root = typeof target === 'string' ? document.querySelector(target) : target;
        if (!root) throw new Error('CsvGrid: target element not found.');
        this.root = root;
        this.opts = {
            globalSearch: true, columnFilters: true, sortable: true,
            statusBar: true, expandButtons: true, align: null, formats: null,
            renderCap: 2000, eagerCells: 200000, worker: true,
            headerMode: 'auto', ...options,
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

    /* Generate the grid's own DOM inside the root (stage 3): optional
     * toolbar, scrollable table, render-cap note, error line, status. */
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

    /* Parse worker, created lazily. null = unavailable (file://, no base
     * URL) -> fall back to synchronous processData. */
    _getWorker() {
        if (this._worker === undefined) {
            const url = this.opts.worker === true
                ? (GRID_BASE ? GRID_BASE + 'worker.js' : null)
                : (typeof this.opts.worker === 'string' ? this.opts.worker : null);
            this._worker = null;
            if (url) {
                try {
                    const w = new Worker(url);
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
        const widths = solveWidths(this.layout.arrays, this.layout.floors, avail);
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
