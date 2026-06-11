/* csv-viewer — zero-dependency CSV viewer SPA. UI half.
 *
 * Data logic (parse, inference, processData) lives in src/core.js, loaded
 * both here (script tag) and in src/worker.js (importScripts). Pipeline:
 * ingest (drop / browse / paste / ?src=) -> processData (synchronous for
 * small inputs, Web Worker for large) -> filter + sort view -> render.
 * All data stays in the browser.
 */

'use strict';

const VERSION = '2.1.1';
const RENDER_CAP = 2000;          // rows rendered before "show all"
const EAGER_CELLS = 200000;       // below this, format + index everything at load
const WIDTH_SAMPLE = 2000;        // rows sampled per column for width percentiles
const INDEX_CHUNK = 10000;        // rows per chunk when building the search index
const WORKER_MIN_CHARS = 1000000; // ~1 MB; below this parse synchronously

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

/* Measure formatted cell and header widths with a canvas in the table's
 * font. Returns {arrays, floors}: per-column sorted cell widths and minimum
 * (header-driven) widths. */
function measureLayout() {
    const canvas = measureLayout._c || (measureLayout._c = document.createElement('canvas'));
    const ctx = canvas.getContext('2d');
    const cs = getComputedStyle($('data-table'));
    const font = `${cs.fontSize} ${cs.fontFamily}`;
    // sampled, not exhaustive: quantiles from ~2K rows per column (2.0.0)
    const sample = sampleIndices(state.rows.length, WIDTH_SAMPLE);
    const arrays = [], floors = [];
    for (let c = 0; c < state.cols.length; c++) {
        ctx.font = `bold ${font}`;
        // 14px ≈ the sort-arrow slot in the header
        floors.push(Math.max(MIN_COL,
            Math.ceil(ctx.measureText(state.cols[c].name).width) + 14 + CELL_PAD));
        ctx.font = font;
        const w = [];
        for (const r of sample) {
            const text = getFormattedRow(r)[c];
            if (text !== '') w.push(Math.ceil(ctx.measureText(text).width) + CELL_PAD);
        }
        w.sort((a, b) => a - b);
        arrays.push(w);
    }
    return { arrays, floors };
}

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

/* Drag-resize: a handle on each header's right edge. Drag sets a manual
 * width override (kept across re-solves until the next file load);
 * double-click fits the column to its content (Excel-style). */
function startColResize(e, c) {
    e.preventDefault();
    e.stopPropagation();
    const table = $('data-table');
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
        state.manualWidths.set(c, w);
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

function fitColumn(c) {
    const { arrays, floors } = state.layout;
    const natural = Math.max(floors[c], arrays[c].length ? arrays[c][arrays[c].length - 1] : 0);
    state.manualWidths.set(c, natural);
    applyLayout();
}

/* Solve against the current viewport and pin widths via <colgroup> +
 * table-layout: fixed. */
function applyLayout() {
    if (!state.layout) return;
    const table = $('data-table');
    const avail = state.expandAll ? Infinity : table.parentElement.clientWidth;
    if (!avail) return;
    const widths = solveWidths(state.layout.arrays, state.layout.floors, avail);
    for (const [c, w] of state.manualWidths) if (c < widths.length) widths[c] = w;
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

// ----------------------------------------------------- lazy format / index

/* Format a row on demand and cache it. Small files are prefilled at load;
 * large files only ever format what rendering, width-sampling, or the
 * search index actually touch. */
function getFormattedRow(r) {
    let f = state.formatted[r];
    if (!f) {
        f = state.cols.map((col, c) => formatCell(state.rows[r][c], col, r));
        state.formatted[r] = f;
    }
    return f;
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

/* Build the global-search index (formatted + raw text per row) in chunks,
 * yielding to the UI between chunks; progress shows in the status bar.
 * The pending query applies automatically on completion. A stale build is
 * abandoned if a new file loads (loadGen). */
function buildSearchIndexChunked() {
    const gen = state.loadGen;
    const n = state.rows.length;
    const raw = new Array(n), low = new Array(n);
    let r = 0;
    state.indexing = 0;
    const step = () => {
        if (gen !== state.loadGen) return;   // a new file arrived; abandon
        const end = Math.min(n, r + INDEX_CHUNK);
        for (; r < end; r++) {
            const s = getFormattedRow(r).join(' ') + ' ' + state.rows[r].join(' ');
            raw[r] = s;
            low[r] = s.toLowerCase();
        }
        if (r < n) {
            state.indexing = r / n;
            renderStatus();
            setTimeout(step, 0);
        } else {
            state.searchRaw = raw;
            state.searchLow = low;
            state.searchReady = true;
            state.indexing = null;
            refresh();
        }
    };
    step();
}

// ------------------------------------------------------------------ state

const state = {
    fileName: '',
    headers: [],
    rows: [],          // raw string cells
    cols: [],          // inference results, parallel to headers
    formatted: [],     // per-row display-string cache (lazy for large files)
    searchRaw: null,   // concatenated row text (formatted + raw) per row
    searchLow: null,   // lower-cased version, for case-insensitive terms
    searchReady: false,
    indexing: null,    // build progress 0..1 while chunking, else null
    loadGen: 0,        // bumped per load; abandons stale index builds
    scores: [],        // fuzzy match score per row (current query)
    layout: null,      // {arrays, floors} from measureLayout, frozen per load
    expandAll: false,  // bypass the squeeze: natural widths + h-scroll (sticky)
    manualWidths: new Map(),   // col index -> px, set by drag-resize
    guessedHeaders: false,
    rawText: '',       // cleaned source text, kept for the header toggle
    view: [],          // row indices after filter + sort
    sortCol: null,
    sortDir: 1,
    globalFilter: '',
    colFilters: [],
    showAll: false,
};

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

function rebuildView() {
    const { rows, cols } = state;
    let terms = parseQuery(state.globalFilter);
    // global search needs the index; kick off the chunked build and leave
    // the global term unapplied until it lands (column filters work now)
    if (terms.length && !state.searchReady) {
        if (state.indexing === null) buildSearchIndexChunked();
        terms = [];
    }
    const hasFuzzy = terms.some(t => t.kind === 'fuzzy' && !t.negate);
    const preds = state.colFilters.map((f, c) => makeColPredicate(f || '', cols[c]));
    const active = preds.some(p => p) || terms.length;

    let idx = [];
    state.scores = [];
    for (let r = 0; r < rows.length; r++) {
        let score = 0;
        if (active) {
            let ok = true;
            for (const t of terms) {
                const s = termScore(t, state.searchLow[r], state.searchRaw[r]);
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
        state.scores[r] = score;
        idx.push(r);
    }

    const sc = state.sortCol;
    if (sc === null && hasFuzzy) {
        // no explicit sort: best fuzzy matches first, original order on ties
        idx.sort((a, b) => (state.scores[b] - state.scores[a]) || (a - b));
    } else if (sc !== null) {
        const col = state.cols[sc];
        const dir = state.sortDir;
        if (col.type === 'text') {
            const coll = new Intl.Collator('en', { sensitivity: 'base', numeric: true });
            idx.sort((a, b) => {
                const x = (state.rows[a][sc] ?? '').trim();
                const y = (state.rows[b][sc] ?? '').trim();
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
    state.view = idx;
}

// -------------------------------------------------------------- rendering

const $ = id => document.getElementById(id);

/* Type-based alignment class, overridden by a markdown alignment spec. */
function cellClass(col) {
    return col.align ? `col-${col.type} align-${col.align}` : `col-${col.type}`;
}

function renderHead() {
    const { cols } = state;
    const head = $('table-head');
    head.innerHTML = '';

    const hr = document.createElement('tr');
    cols.forEach((col, c) => {
        const th = document.createElement('th');
        th.className = cellClass(col);
        const arrow = state.sortCol === c ? (state.sortDir === 1 ? '▲' : '▼') : '';
        th.innerHTML = `<span class="sort-arrow">${arrow}</span>${escapeHtml(col.name)}`;
        th.title = `${col.name} (${col.type}) — click to sort`;
        th.addEventListener('click', () => onSort(c));
        const grip = document.createElement('span');
        grip.className = 'col-resizer';
        grip.title = 'Drag to resize — double-click to fit content';
        grip.addEventListener('mousedown', e => startColResize(e, c));
        grip.addEventListener('dblclick', e => { e.stopPropagation(); fitColumn(c); });
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
        inp.value = state.colFilters[c] || '';
        inp.addEventListener('input', () => {
            state.colFilters[c] = inp.value;
            inp.classList.toggle('active-filter', inp.value.trim() !== '');
            refresh();
        });
        inp.addEventListener('keydown', e => {
            if (e.key === 'Escape') {
                e.preventDefault();
                inp.value = '';
                state.colFilters[c] = '';
                inp.classList.remove('active-filter');
                inp.blur();
                refresh();
            }
        });
        th.appendChild(inp);
        fr.appendChild(th);
    });
    head.appendChild(fr);
}

function renderBody() {
    const { cols, view } = state;
    const cap = state.showAll ? view.length : Math.min(view.length, RENDER_CAP);
    const parts = [];
    for (let i = 0; i < cap; i++) {
        const r = view[i];
        const frow = getFormattedRow(r);
        const cells = cols.map((col, c) => {
            const text = frow[c];
            if (text === '') return `<td class="${cellClass(col)} blank">·</td>`;
            return `<td class="${cellClass(col)}">${escapeHtml(text)}</td>`;
        });
        parts.push(`<tr>${cells.join('')}</tr>`);
    }
    $('table-body').innerHTML = parts.join('');

    const note = $('render-cap-note');
    if (view.length > cap) {
        note.classList.remove('d-none');
        $('show-all-btn').textContent =
            `Showing first ${cap.toLocaleString()} of ${view.length.toLocaleString()} rows — show all`;
    } else {
        note.classList.add('d-none');
    }
}

function renderStatus() {
    const fmt = n => n.toLocaleString();
    const total = state.rows.length;
    const shown = state.view.length;
    const cap = state.showAll ? shown : Math.min(shown, RENDER_CAP);
    let s = state.fileName ? state.fileName + ' — ' : '';
    s += shown === total ? `${fmt(total)} rows` : `${fmt(shown)} of ${fmt(total)} rows`;
    s += ` × ${state.cols.length} cols`;
    if (cap < shown) s += ` — showing rows 1–${fmt(cap)}`;
    if (state.guessedHeaders) s += ' (headers guessed)';
    if (state.indexing !== null) s += ` — indexing search ${Math.round(state.indexing * 100)}%`;
    $('status').textContent = s;
}

function refresh() {
    rebuildView();
    renderBody();
    renderStatus();
}

function escapeHtml(s) {
    return s.replace(/&/g, '&amp;').replace(/</g, '&lt;')
            .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

// ----------------------------------------------------------------- events

function onSort(c) {
    if (state.sortCol === c) {
        if (state.sortDir === 1) state.sortDir = -1;
        else { state.sortCol = null; state.sortDir = 1; }   // third click: reset
    } else {
        state.sortCol = c; state.sortDir = 1;
    }
    renderHead();
    refresh();
}

/* Parse worker, created lazily. false = unavailable (file://) -> fall
 * back to synchronous processData. */
let parseWorker = null;
let loadRequest = null;       // {gen, fileName, text} awaiting the worker
let loadRequestGen = 0;

function getParseWorker() {
    if (parseWorker === null) {
        try {
            parseWorker = new Worker('src/worker.js');
            parseWorker.onmessage = e => {
                const { gen, result, error } = e.data;
                if (!loadRequest || gen !== loadRequest.gen) return;   // stale reply
                const req = loadRequest;
                loadRequest = null;
                if (error) showError(error);
                else installData(result, req.fileName, req.text);
            };
            parseWorker.onerror = () => {
                if (loadRequest) { loadRequest = null; showError('Background parse failed.'); }
            };
        } catch {
            parseWorker = false;
        }
    }
    return parseWorker;
}

/* headerOverride: null = auto-detect, true = force row 1 as header,
 * false = force headerless (guessed names). Large texts parse in the
 * worker (UI stays live, status bar shows progress); small ones inline. */
function loadText(text, fileName, headerOverride = null) {
    try {
        text = cleanCsvText(text);
        if (!text.trim()) throw new Error('No data found.');
        const w = text.length >= WORKER_MIN_CHARS ? getParseWorker() : null;
        if (w) {
            loadRequest = { gen: ++loadRequestGen, fileName, text };
            $('status-bar').classList.remove('d-none');
            $('status').textContent = `parsing ${fileName || 'data'} (${(text.length / 1e6).toFixed(1)} MB)…`;
            w.postMessage({ gen: loadRequest.gen, text, headerOverride });
        } else {
            installData(processData(text, headerOverride), fileName, text);
        }
    } catch (err) {
        showError(err.message || String(err));
    }
}

/* Install a processData result into state and show the table. */
function installData(d, fileName, text) {
    const { rows, cols } = d;
    state.loadGen++;
    state.rawText = text;             // kept for the header toggle
    state.fileName = fileName || '';
    state.guessedHeaders = d.headerless;
    state.headers = d.headers;
    state.rows = rows;
    state.cols = cols;
    state.formatted = new Array(rows.length);
    state.searchRaw = null;
    state.searchLow = null;
    state.searchReady = false;
    state.indexing = null;
    if (rows.length * cols.length <= EAGER_CELLS) {
        // small file: prefill everything, exactly the pre-2.0 behavior
        for (let r = 0; r < rows.length; r++) getFormattedRow(r);
        state.searchRaw = state.formatted.map(
            (frow, r) => frow.join(' ') + ' ' + rows[r].join(' '));
        state.searchLow = state.searchRaw.map(s => s.toLowerCase());
        state.searchReady = true;
    }
    state.sortCol = null;
    state.sortDir = 1;
    state.globalFilter = '';
    state.colFilters = new Array(cols.length).fill('');
    state.manualWidths = new Map();
    state.showAll = false;

    $('global-filter').value = '';
    $('ingest-error').classList.add('d-none');
    $('ingest-view').classList.add('d-none');
    $('table-view').classList.remove('d-none');
    $('toolbar').classList.remove('d-none');
    $('status-bar').classList.remove('d-none');
    $('header-btn').classList.toggle('active', !d.headerless);
    renderHead();
    state.layout = measureLayout();   // frozen for this load
    applyLayout();
    refresh();
}
function loadFile(file) {
    const reader = new FileReader();
    reader.onload = () => loadText(reader.result, file.name);
    reader.onerror = () => showError(`Could not read ${file.name}.`);
    reader.readAsText(file);
}

function showError(msg) {
    showIngest();
    $('error-message').textContent = msg;
    $('ingest-error').classList.remove('d-none');
}

function showIngest() {
    $('table-view').classList.add('d-none');
    $('toolbar').classList.add('d-none');
    $('status-bar').classList.add('d-none');
    $('ingest-view').classList.remove('d-none');
}

function initEvents() {
    const dz = $('drop-zone'), fi = $('file-input');

    dz.addEventListener('click', () => fi.click());
    $('browse-btn').addEventListener('click', () => fi.click());
    fi.addEventListener('change', () => { if (fi.files.length) loadFile(fi.files[0]); fi.value = ''; });

    // drag & drop: highlight the zone, but accept a drop anywhere on the page
    document.addEventListener('dragover', e => {
        e.preventDefault();
        dz.classList.add('drag-over');
    });
    document.addEventListener('dragleave', e => {
        if (!e.relatedTarget) dz.classList.remove('drag-over');
    });
    document.addEventListener('drop', e => {
        e.preventDefault();
        dz.classList.remove('drag-over');
        if (e.dataTransfer.files.length) loadFile(e.dataTransfer.files[0]);
    });

    $('paste-btn').addEventListener('click', () => loadText($('paste-input').value, 'pasted data'));

    // Ctrl+V on the ingest screen (outside the textarea) loads the clipboard
    document.addEventListener('paste', e => {
        if (!$('ingest-view').classList.contains('d-none')
            && e.target !== $('paste-input')) {
            const text = e.clipboardData.getData('text');
            if (text.trim()) { e.preventDefault(); loadText(text, 'pasted data'); }
        }
    });

    $('global-filter').addEventListener('input', e => {
        state.globalFilter = e.target.value;
        refresh();
    });
    $('global-filter').addEventListener('keydown', e => {
        if (e.key === 'Escape') {
            e.preventDefault();
            e.target.value = '';
            state.globalFilter = '';
            e.target.blur();
            refresh();
        }
    });

    // Ctrl+O: from the table, back to ingest; from ingest, straight to browse
    document.addEventListener('keydown', e => {
        if (e.ctrlKey && !e.shiftKey && !e.altKey && e.key.toLowerCase() === 'o') {
            e.preventDefault();
            if ($('ingest-view').classList.contains('d-none')) showIngest();
            else fi.click();
        }
    });
    $('clear-filters-btn').addEventListener('click', () => {
        state.globalFilter = '';
        state.colFilters = state.colFilters.map(() => '');
        $('global-filter').value = '';
        renderHead();
        refresh();
    });
    $('open-btn').addEventListener('click', showIngest);
    $('show-all-btn').addEventListener('click', () => {
        state.showAll = true;
        renderBody();
        renderStatus();
    });
    // separate buttons by design — no mode-flipping play/pause toggles
    $('expand-btn').addEventListener('click', () => {
        state.expandAll = true;
        applyLayout();
    });
    $('contract-btn').addEventListener('click', () => {
        state.expandAll = false;
        state.manualWidths.clear();
        applyLayout();
    });
    // re-interpret the loaded data with the opposite header assumption
    $('header-btn').addEventListener('click', () => {
        if (state.rawText) loadText(state.rawText, state.fileName, state.guessedHeaders);
    });

    // re-solve column widths on resize (widths stay frozen w.r.t. filtering)
    let resizeTimer = null;
    window.addEventListener('resize', () => {
        clearTimeout(resizeTimer);
        resizeTimer = setTimeout(applyLayout, 150);
    });

    // tooltip with the full text, only for cells actually truncated
    $('data-table').addEventListener('mouseover', e => {
        const cell = e.target.closest('td, th');
        if (cell && !cell.title && cell.scrollWidth > cell.clientWidth) {
            cell.title = cell.textContent;
        }
    });
}

/* Auto-load a CSV from ?src=<url>. Subject to CORS on cross-origin hosts;
 * intended for same-origin embeds (e.g. a blog post's own resources). */
function loadFromUrl(url) {
    fetch(url)
        .then(resp => {
            if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
            return resp.text();
        })
        .then(text => loadText(text, decodeURIComponent(url.split('/').pop() || url)))
        .catch(err => showError(`Could not load ?src=${url} — ${err.message}`));
}

/* Register the service worker (PWA install + offline shell). Only possible
 * on https or localhost; a no-op when opened from file://. */
function initPWA() {
    if ('serviceWorker' in navigator
        && (location.protocol === 'https:'
            || ['localhost', '127.0.0.1'].includes(location.hostname))) {
        navigator.serviceWorker.register('sw.js').catch(() => {});
    }
}

document.addEventListener('DOMContentLoaded', () => {
    $('header-version').textContent = 'v' + VERSION;
    initEvents();
    initPWA();
    const src = new URLSearchParams(location.search).get('src');
    if (src) loadFromUrl(src);
});
