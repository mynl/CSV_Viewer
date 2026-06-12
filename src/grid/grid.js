/* csv-grid — the embeddable grid half of csv-viewer.
 *
 * CsvGrid renders one table from a processData result: type-aware
 * formatting, fzf global search, per-column filters, sort, equal-risk
 * column widths, lazy formatting and a chunked search index for large
 * files. Pure data logic (parse, inference, processData) lives in
 * core.js; viewer chrome (ingest, drop/paste, toolbar, PWA) in
 * src/app/app.js. Stage 1 of plan-3.0: the grid still renders into the
 * viewer's existing markup, handed in via the constructor — it generates
 * its own DOM in stage 3. No module-global state: multiple instances per
 * page must stay possible.
 */

'use strict';

const RENDER_CAP = 2000;          // rows rendered before "show all"
const EAGER_CELLS = 200000;       // below this, format + index everything at load
const WIDTH_SAMPLE = 2000;        // rows sampled per column for width percentiles
const INDEX_CHUNK = 10000;        // rows per chunk when building the search index

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

function formatCell(raw, col, r) {
    raw = (raw ?? '').trim();
    if (raw === '') return '';
    if (col.type === 'number') {
        const v = col.values[r];
        if (v === null) return raw;
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
 * resize. */

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

/* Type-based alignment class, overridden by a markdown alignment spec. */
function cellClass(col) {
    return col.align ? `col-${col.type} align-${col.align}` : `col-${col.type}`;
}

function escapeHtml(s) {
    return s.replace(/&/g, '&amp;').replace(/</g, '&lt;')
            .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

// ----------------------------------------------------------------- CsvGrid

class CsvGrid {
    /* els: {table, head, body, status, capNote, showAllBtn} — existing
     * viewer markup (stage 1). All listeners bind to these elements, never
     * to document; the drag-resize mousemove/mouseup pair is the one
     * transient exception. */
    constructor(els) {
        this.els = els;

        this.fileName = '';
        this.headers = [];
        this.rows = [];          // raw string cells
        this.cols = [];          // inference results, parallel to headers
        this.formatted = [];     // per-row display-string cache (lazy for large files)
        this.searchRaw = null;   // concatenated row text (formatted + raw) per row
        this.searchLow = null;   // lower-cased version, for case-insensitive terms
        this.searchReady = false;
        this.indexing = null;    // build progress 0..1 while chunking, else null
        this.loadGen = 0;        // bumped per load; abandons stale index builds
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

        this.els.showAllBtn.addEventListener('click', () => {
            this.showAll = true;
            this.renderBody();
            this.renderStatus();
        });
        // tooltip with the full text, only for cells actually truncated
        this.els.table.addEventListener('mouseover', e => {
            const cell = e.target.closest('td, th');
            if (cell && !cell.title && cell.scrollWidth > cell.clientWidth) {
                cell.title = cell.textContent;
            }
        });
    }

    // ------------------------------------------------------------ data in

    /* Install a processData result and (re)render. The host must make the
     * table visible first — width measurement reads the live DOM. */
    setData(d, fileName) {
        const { rows, cols } = d;
        this.loadGen++;
        this.fileName = fileName || '';
        this.guessedHeaders = d.headerless;
        this.headers = d.headers;
        this.rows = rows;
        this.cols = cols;
        this.formatted = new Array(rows.length);
        this.searchRaw = null;
        this.searchLow = null;
        this.searchReady = false;
        this.indexing = null;
        if (rows.length * cols.length <= EAGER_CELLS) {
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
        this.renderHead();
        this.layout = this.measureLayout();   // frozen for this load
        this.applyLayout();
        this.refresh();
    }

    // ----------------------------------------------------- public controls

    setGlobalFilter(q) {
        this.globalFilter = q;
        this.refresh();
    }

    clearFilters() {
        this.globalFilter = '';
        this.colFilters = this.colFilters.map(() => '');
        this.renderHead();
        this.refresh();
    }

    /* Expand/contract are separate explicit actions by design — no
     * mode-flipping toggles. */
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
        document.body.classList.add('col-resizing');
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
            document.body.classList.remove('col-resizing');
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
     * status bar. The pending query applies automatically on completion. A
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
            const arrow = this.sortCol === c ? (this.sortDir === 1 ? '▲' : '▼') : '';
            th.innerHTML = `<span class="sort-arrow">${arrow}</span>${escapeHtml(col.name)}`;
            th.title = `${col.name} (${col.type}) — click to sort`;
            th.addEventListener('click', () => this.onSort(c));
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

        const fr = document.createElement('tr');
        fr.className = 'filter-row';
        cols.forEach((col, c) => {
            const th = document.createElement('th');
            const inp = document.createElement('input');
            inp.type = 'text';
            inp.className = 'form-control form-control-sm';
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
        const cap = this.showAll ? view.length : Math.min(view.length, RENDER_CAP);
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
            note.classList.remove('d-none');
            this.els.showAllBtn.textContent =
                `Showing first ${cap.toLocaleString()} of ${view.length.toLocaleString()} rows — show all`;
        } else {
            note.classList.add('d-none');
        }
    }

    renderStatus() {
        const fmt = n => n.toLocaleString();
        const total = this.rows.length;
        const shown = this.view.length;
        const cap = this.showAll ? shown : Math.min(shown, RENDER_CAP);
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
