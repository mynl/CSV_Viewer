/* csv-viewer — zero-dependency CSV viewer SPA.
 *
 * Pipeline: ingest (drop / browse / paste) -> parse (RFC 4180, sniffed
 * delimiter) -> per-column type inference (number / date / text) ->
 * filter + sort view -> render. All data stays in the browser.
 */

'use strict';

const VERSION = '1.0.0';
const RENDER_CAP = 2000;          // rows rendered before "show all"

// ---------------------------------------------------------------- parsing

/* Sniff the delimiter from the first ~20 lines: the candidate with the
 * highest, most consistent per-line field count (> 1) wins. */
function sniffDelimiter(text) {
    const candidates = [',', '\t', ';', '|'];
    const lines = text.split(/\r\n|\n|\r/, 20).filter(l => l.length);
    let best = ',', bestScore = 0;
    for (const d of candidates) {
        const counts = lines.map(l => splitLine(l, d).length);
        const first = counts[0];
        if (first < 2) continue;
        const consistent = counts.every(c => c === first);
        const score = first * (consistent ? 10 : 1);
        if (score > bestScore) { bestScore = score; best = d; }
    }
    return best;
}

/* Quote-aware split of a single line — used only for sniffing. */
function splitLine(line, delim) {
    const out = [];
    let cur = '', inQ = false;
    for (let i = 0; i < line.length; i++) {
        const ch = line[i];
        if (inQ) {
            if (ch === '"') { inQ = false; } else { cur += ch; }
        } else if (ch === '"') { inQ = true; }
        else if (ch === delim) { out.push(cur); cur = ''; }
        else { cur += ch; }
    }
    out.push(cur);
    return out;
}

/* RFC 4180 parser: quoted fields, doubled quotes, embedded delimiters and
 * newlines. Returns array of rows (arrays of strings). */
function parseCSV(text, delim) {
    const rows = [];
    let row = [], cur = '', inQ = false, i = 0;
    const n = text.length;
    while (i < n) {
        const ch = text[i];
        if (inQ) {
            if (ch === '"') {
                if (text[i + 1] === '"') { cur += '"'; i += 2; continue; }
                inQ = false; i++; continue;
            }
            cur += ch; i++; continue;
        }
        if (ch === '"') { inQ = true; i++; continue; }
        if (ch === delim) { row.push(cur); cur = ''; i++; continue; }
        if (ch === '\r' || ch === '\n') {
            row.push(cur); cur = '';
            rows.push(row); row = [];
            if (ch === '\r' && text[i + 1] === '\n') i++;
            i++; continue;
        }
        cur += ch; i++;
    }
    if (cur.length || row.length) { row.push(cur); rows.push(row); }
    // drop trailing fully-blank lines
    while (rows.length && rows[rows.length - 1].every(c => c.trim() === '')) rows.pop();
    return rows;
}

// --------------------------------------------------------- type inference

const NUM_RE = /^\(?\$?-?[0-9][0-9,]*(\.[0-9]+)?%?\)?$/;
const ISO_RE = /^(\d{4})-(\d{1,2})-(\d{1,2})(?:[T ](\d{1,2}):(\d{2})(?::(\d{2})(?:\.\d+)?)?Z?)?$/;
const US_RE  = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/;

/* Parse a number: thousands commas, (123) negatives, leading $, trailing %.
 * Returns {v, dec} or null. */
function parseNumber(s) {
    s = s.trim();
    if (!NUM_RE.test(s)) return null;
    let neg = false;
    if (s.startsWith('(') && s.endsWith(')')) { neg = true; s = s.slice(1, -1); }
    let pct = false;
    if (s.endsWith('%')) { pct = true; s = s.slice(0, -1); }
    s = s.replace(/[$,]/g, '');
    let v = parseFloat(s);
    if (!isFinite(v)) return null;
    if (neg) v = -v;
    if (pct) v /= 100;
    const dot = s.indexOf('.');
    let dec = dot < 0 ? 0 : s.length - dot - 1;
    if (pct) dec += 2;
    return { v, dec };
}

/* Parse a date (ISO or US slash). Returns {t, hasTime} or null. */
function parseDate(s) {
    s = s.trim();
    let m = ISO_RE.exec(s);
    if (m) {
        const [, y, mo, d, h, mi, se] = m;
        const t = new Date(+y, mo - 1, +d, +(h || 0), +(mi || 0), +(se || 0));
        if (t.getMonth() !== mo - 1 || t.getDate() !== +d) return null;
        return { t: t.getTime(), hasTime: h !== undefined };
    }
    m = US_RE.exec(s);
    if (m) {
        const [, mo, d, y] = m;
        const t = new Date(+y, mo - 1, +d);
        if (t.getMonth() !== mo - 1 || t.getDate() !== +d) return null;
        return { t: t.getTime(), hasTime: false };
    }
    return null;
}

/* Classify each column over its non-blank values: number if all parse as
 * numbers, else date if all parse as dates, else text. Strict for v1.0. */
function inferColumns(headers, rows) {
    return headers.map((name, c) => {
        let isNum = true, isDate = true, maxDec = 0, hasTime = false, seen = 0;
        const numv = new Array(rows.length).fill(null);
        const datev = new Array(rows.length).fill(null);
        for (let r = 0; r < rows.length; r++) {
            const raw = (rows[r][c] ?? '').trim();
            if (raw === '') continue;
            seen++;
            if (isNum) {
                const p = parseNumber(raw);
                if (p) { numv[r] = p.v; if (p.dec > maxDec) maxDec = p.dec; }
                else isNum = false;
            }
            if (isDate) {
                const p = parseDate(raw);
                if (p) { datev[r] = p.t; hasTime = hasTime || p.hasTime; }
                else isDate = false;
            }
            if (!isNum && !isDate) break;
        }
        if (seen === 0) return { name, type: 'text', values: null };
        if (isNum) return { name, type: 'number', dec: Math.min(maxDec, 6), values: numv };
        if (isDate) return { name, type: 'date', hasTime, values: datev };
        return { name, type: 'text', values: null };
    });
}

// ------------------------------------------------------------- formatting

function formatCell(raw, col, r) {
    raw = (raw ?? '').trim();
    if (raw === '') return '';
    if (col.type === 'number') {
        const v = col.values[r];
        if (v === null) return raw;
        return v.toLocaleString('en-US',
            { minimumFractionDigits: col.dec, maximumFractionDigits: col.dec });
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

// ------------------------------------------------------------------ state

const state = {
    fileName: '',
    headers: [],
    rows: [],          // raw string cells
    cols: [],          // inference results, parallel to headers
    formatted: [],     // formatted display strings, parallel to rows
    searchable: [],    // lower-cased concatenated row text for global filter
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
    const global = state.globalFilter.trim().toLowerCase();
    const preds = state.colFilters.map((f, c) => makeColPredicate(f || '', cols[c]));
    const active = preds.some(p => p) || global;

    let idx = [];
    for (let r = 0; r < rows.length; r++) {
        if (active) {
            if (global && !state.searchable[r].includes(global)) continue;
            let ok = true;
            for (let c = 0; c < preds.length; c++) {
                if (preds[c] && !preds[c]((rows[r][c] ?? ''), r)) { ok = false; break; }
            }
            if (!ok) continue;
        }
        idx.push(r);
    }

    const sc = state.sortCol;
    if (sc !== null) {
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

function renderHead() {
    const { cols } = state;
    const head = $('table-head');
    head.innerHTML = '';

    const hr = document.createElement('tr');
    cols.forEach((col, c) => {
        const th = document.createElement('th');
        th.className = `col-${col.type}`;
        const arrow = state.sortCol === c ? (state.sortDir === 1 ? '▲' : '▼') : '';
        th.innerHTML = `<span class="sort-arrow">${arrow}</span>${escapeHtml(col.name)}`;
        th.title = `${col.name} (${col.type}) — click to sort`;
        th.addEventListener('click', () => onSort(c));
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
        th.appendChild(inp);
        fr.appendChild(th);
    });
    head.appendChild(fr);
}

function renderBody() {
    const { rows, cols, view, formatted } = state;
    const cap = state.showAll ? view.length : Math.min(view.length, RENDER_CAP);
    const parts = [];
    for (let i = 0; i < cap; i++) {
        const r = view[i];
        const cells = cols.map((col, c) => {
            const text = formatted[r][c];
            if (text === '') return `<td class="col-${col.type} blank">·</td>`;
            const raw = (rows[r][c] ?? '').trim();
            const title = raw.length > 50 ? ` title="${escapeHtml(raw)}"` : '';
            return `<td class="col-${col.type}"${title}>${escapeHtml(text)}</td>`;
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
    const total = state.rows.length;
    const shown = state.view.length;
    const counts = shown === total
        ? `${total.toLocaleString()} rows`
        : `${shown.toLocaleString()} of ${total.toLocaleString()} rows`;
    $('status').textContent =
        `${state.fileName ? state.fileName + ' — ' : ''}${counts} × ${state.cols.length} cols`;
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

function loadText(text, fileName) {
    try {
        if (!text || !text.trim()) throw new Error('No data found.');
        const delim = sniffDelimiter(text);
        const all = parseCSV(text, delim);
        if (all.length < 2) throw new Error('Need a header row and at least one data row.');
        const headers = all[0].map((h, i) => h.trim() || `col${i + 1}`);
        const rows = all.slice(1).map(r => {
            // normalize ragged rows to header length
            if (r.length === headers.length) return r;
            const out = r.slice(0, headers.length);
            while (out.length < headers.length) out.push('');
            return out;
        });
        const cols = inferColumns(headers, rows);
        state.fileName = fileName || '';
        state.headers = headers;
        state.rows = rows;
        state.cols = cols;
        state.formatted = rows.map((row, r) => cols.map((col, c) => formatCell(row[c], col, r)));
        state.searchable = state.formatted.map(
            (frow, r) => (frow.join(' ') + ' ' + rows[r].join(' ')).toLowerCase());
        state.sortCol = null;
        state.sortDir = 1;
        state.globalFilter = '';
        state.colFilters = new Array(headers.length).fill('');
        state.showAll = false;

        $('global-filter').value = '';
        $('ingest-error').classList.add('d-none');
        $('ingest-view').classList.add('d-none');
        $('table-view').classList.remove('d-none');
        $('toolbar').classList.remove('d-none');
        renderHead();
        refresh();
    } catch (err) {
        showError(err.message || String(err));
    }
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
    $('ingest-view').classList.remove('d-none');
}

function initEvents() {
    const dz = $('drop-zone'), fi = $('file-input');

    dz.addEventListener('click', () => fi.click());
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
    $('clear-filters-btn').addEventListener('click', () => {
        state.globalFilter = '';
        state.colFilters = state.colFilters.map(() => '');
        $('global-filter').value = '';
        renderHead();
        refresh();
    });
    $('open-btn').addEventListener('click', showIngest);
    $('show-all-btn').addEventListener('click', () => { state.showAll = true; renderBody(); });
}

document.addEventListener('DOMContentLoaded', () => {
    $('version').textContent = 'v' + VERSION;
    initEvents();
});
