/* csv-viewer — zero-dependency CSV viewer SPA.
 *
 * Pipeline: ingest (drop / browse / paste) -> parse (RFC 4180, sniffed
 * delimiter) -> per-column type inference (number / date / text) ->
 * filter + sort view -> render. All data stays in the browser.
 */

'use strict';

const VERSION = '1.4.3';
const RENDER_CAP = 2000;          // rows rendered before "show all"

// ---------------------------------------------------------------- parsing

/* Strip a UTF-8 BOM and leading blank/whitespace-only lines — bank
 * downloads often have both, and a leading blank line otherwise makes the
 * file look single-column. */
function cleanCsvText(text) {
    return (text ?? '').replace(/^\uFEFF/, '').replace(/^(?:[ \t]*(?:\r\n|\n|\r))+/, '');
}

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

const NUM_RE = /^\(?\$?-?(?:[0-9][0-9,]*(?:\.[0-9]+)?|\.[0-9]+)(?:[eE][+-]?[0-9]+)?%?\)?$/;
const ISO_RE = /^(\d{4})-(\d{1,2})-(\d{1,2})(?:[T ](\d{1,2}):(\d{2})(?::(\d{2})(?:\.\d+)?)?Z?)?$/;
const NUMDATE_RE = /^(\d{1,4})([\/\-.])(\d{1,2})\2(\d{1,4})$/;
const DMON_RE = /^(\d{1,2})[ \-]([A-Za-z]{3,9})\.?,?[ \-](\d{2,4})$/;   // 5 Jan 2024, 05-Jan-24
const MOND_RE = /^([A-Za-z]{3,9})\.?,?[ \-](\d{1,2}),?[ \-](\d{2,4})$/; // Jan 5, 2024
const MONTH_NAMES = ['january', 'february', 'march', 'april', 'may', 'june',
    'july', 'august', 'september', 'october', 'november', 'december'];

/* Parse a number: thousands commas, (123) negatives, leading $, trailing %,
 * scientific notation (1e-03), bare leading-dot floats (.5).
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
    // decimals implied by the string, exponent-aware: 1e-03 -> 3, 1.5e-3 -> 4
    const em = /^([^eE]*)[eE]([+-]?\d+)$/.exec(s);
    const mant = em ? em[1] : s;
    const exp = em ? +em[2] : 0;
    const dot = mant.indexOf('.');
    let dec = Math.max(0, (dot < 0 ? 0 : mant.length - dot - 1) - exp);
    if (pct) dec += 2;
    return { v, dec };
}

function monthNum(word) {
    const w = word.toLowerCase();
    const i = MONTH_NAMES.findIndex(n => n.startsWith(w) || (w === 'sept' && n === 'september'));
    return i < 0 || w.length < 3 ? null : i + 1;
}

/* Two-digit year pivot: <50 → 20xx, else 19xx. */
function fixYear(y) { y = +y; return y < 100 ? (y < 50 ? 2000 + y : 1900 + y) : y; }

function makeDate(y, mo, d, h = 0, mi = 0, se = 0, hasTime = false) {
    const t = new Date(y, mo - 1, d, h, mi, se);
    if (t.getFullYear() !== y || t.getMonth() !== mo - 1 || t.getDate() !== +d) return null;
    return { t: t.getTime(), hasTime };
}

/* Parse a date liberally: ISO (optional time), numeric triples with / - .
 * separators and 2- or 4-digit years, month-name forms. `dayFirst` resolves
 * the ambiguous all-numeric case (05/01/2024) — choose it per COLUMN (see
 * inferColumns), not per value. Returns {t, hasTime} or null. */
function parseDate(s, dayFirst = false) {
    s = s.trim();
    let m = ISO_RE.exec(s);
    if (m) {
        const [, y, mo, d, h, mi, se] = m;
        const r = makeDate(+y, +mo, +d, +(h || 0), +(mi || 0), +(se || 0), h !== undefined);
        return r;
    }
    m = NUMDATE_RE.exec(s);
    if (m) {
        const [, a, , b, c] = m;
        if (a.length === 4 && c.length <= 2) return makeDate(+a, +b, +c);   // y/m/d
        if (a.length <= 2 && (c.length === 4 || c.length === 2)) {          // d/m/y or m/d/y
            const y = fixYear(c);
            if (+a > 12 && +b <= 12) return makeDate(y, +b, +a);            // forced day-first
            if (+b > 12 && +a <= 12) return makeDate(y, +a, +b);            // forced month-first
            return dayFirst ? makeDate(y, +b, +a) : makeDate(y, +a, +b);
        }
        return null;
    }
    m = DMON_RE.exec(s);
    if (m) {
        const mo = monthNum(m[2]);
        return mo ? makeDate(fixYear(m[3]), mo, +m[1]) : null;
    }
    m = MOND_RE.exec(s);
    if (m) {
        const mo = monthNum(m[1]);
        return mo ? makeDate(fixYear(m[3]), mo, +m[2]) : null;
    }
    return null;
}

/* True if this value pins the ambiguous numeric form to day-first. */
function dateNeedsDayFirst(s) {
    const m = NUMDATE_RE.exec(s.trim());
    return !!m && m[1].length <= 2 && +m[1] > 12 && +m[3] <= 12;
}

const YEAR_TITLE_RE = /\b(year|yr|vintage|cohort)\b/i;
const MONEY_TITLE_RE = /\b(amount|amt|balance|bal|price|cost|fee|fees|charge|paid|payment|debit|credit|total|premium|loss|salary|wage|income|expense|revenue|usd|gbp|eur|cad)\b|[$£€]/i;

/* Choose a numeric column's display format (greater_tables rules):
 *   year  — integers, header says year-ish OR all values in (1800, 2030);
 *           plain, no commas
 *   int   — all integer-valued; commas, no decimals
 *   eng   — floats spanning > 6 orders of magnitude; engineering format
 *   float — uniform decimals d = clamp(min(maxObservedDecimals,
 *           3 - floor(log10(mean|x| over nonzero))), 0, 6): ~4 significant
 *           digits at the column's typical magnitude, never more precision
 *           than the raw data carried. */
function classifyNumber(name, values, maxDec) {
    const xs = values.filter(v => v !== null);
    const allInt = xs.every(v => Number.isInteger(v));
    if (allInt && xs.length) {
        const yearish = YEAR_TITLE_RE.test(name) || xs.every(v => v > 1800 && v < 2030);
        if (yearish) return { format: 'year', dec: 0 };
        // money by title trumps everything below (author: "deffo 2dp")
        if (MONEY_TITLE_RE.test(name)) return { format: 'float', dec: 2 };
        return { format: 'int', dec: 0 };
    }
    if (!allInt && MONEY_TITLE_RE.test(name)) return { format: 'float', dec: 2 };
    const nz = xs.filter(v => v !== 0).map(Math.abs);
    if (!nz.length) return { format: 'float', dec: Math.min(maxDec, 6) };
    // money by value: ≤ 2 observed decimals and everything under 100,000
    if (!allInt && maxDec <= 2 && Math.max(...nz) < 1e5) return { format: 'float', dec: 2 };
    if (Math.max(...nz) / Math.min(...nz) > 1e6) return { format: 'eng', dec: 0 };
    const meanAbs = nz.reduce((a, b) => a + b, 0) / nz.length;
    const dec = Math.max(0, Math.min(maxDec, 3 - Math.floor(Math.log10(meanAbs)), 6));
    return { format: 'float', dec };
}

/* Engineering format, 3 significant digits, SI suffixes n..T. */
const ENG_SUFFIX = { '-9': 'n', '-6': 'µ', '-3': 'm', 0: '', 3: 'k', 6: 'M', 9: 'G', 12: 'T' };

function engFormat(v) {
    if (v === 0) return '0';
    const a = Math.abs(v);
    let e = Math.floor(Math.log10(a) / 3) * 3;
    e = Math.max(-9, Math.min(12, e));
    const m = a / 10 ** e;
    return (v < 0 ? '-' : '') + Number(m.toPrecision(3)) + ENG_SUFFIX[e];
}

/* Classify each column over its non-blank values: number if all parse as
 * numbers, else date if all parse as dates, else text. Strict for v1.0. */
function inferColumns(headers, rows) {
    return headers.map((name, c) => {
        let isNum = true, isDate = true, maxDec = 0, seen = 0;
        const numv = new Array(rows.length).fill(null);
        for (let r = 0; r < rows.length; r++) {
            const raw = (rows[r][c] ?? '').trim();
            if (raw === '') continue;
            seen++;
            if (isNum) {
                const p = parseNumber(raw);
                if (p) { numv[r] = p.v; if (p.dec > maxDec) maxDec = p.dec; }
                else isNum = false;
            }
            // candidacy only: ambiguous m/d vs d/m is resolved per column below
            if (isDate && !(parseDate(raw, false) || parseDate(raw, true))) isDate = false;
            if (!isNum && !isDate) break;
        }
        if (seen === 0) return { name, type: 'text', values: null };
        if (isNum) {
            const cls = classifyNumber(name, numv, maxDec);
            return { name, type: 'number', format: cls.format, dec: cls.dec, values: numv };
        }
        if (isDate) {
            // second pass with a single per-column day/month convention
            let dayFirst = false, hasTime = false;
            for (let r = 0; r < rows.length; r++) {
                const raw = (rows[r][c] ?? '').trim();
                if (raw !== '' && dateNeedsDayFirst(raw)) { dayFirst = true; break; }
            }
            const datev = new Array(rows.length).fill(null);
            for (let r = 0; r < rows.length; r++) {
                const raw = (rows[r][c] ?? '').trim();
                if (raw === '') continue;
                const p = parseDate(raw, dayFirst);
                if (p) { datev[r] = p.t; hasTime = hasTime || p.hasTime; }
            }
            return { name, type: 'date', hasTime, values: datev };
        }
        return { name, type: 'text', values: null };
    });
}

/* Headerless detection (bank-export style): the first row is data, not
 * headers, if any cell parses as a number or a date — real headers are
 * text. All-text files are ambiguous and keep first-row-as-header. */
function looksHeaderless(firstRow) {
    return firstRow.some(c => {
        const s = (c ?? '').trim();
        return s !== '' && (parseNumber(s) !== null || parseDate(s) !== null);
    });
}

/* Name guessed columns by inferred type: Date / Amount / Description
 * (Year for year-formatted integers), numbered when a type repeats.
 * Mutates col.name in place. */
function guessHeaders(cols) {
    const baseName = c => c.type === 'date' ? 'Date'
        : c.type === 'number' ? (c.format === 'year' ? 'Year' : 'Amount')
        : 'Description';
    const counts = {}, seen = {};
    cols.forEach(c => { const b = baseName(c); counts[b] = (counts[b] || 0) + 1; });
    cols.forEach(c => {
        const b = baseName(c);
        seen[b] = (seen[b] || 0) + 1;
        c.name = counts[b] > 1 ? `${b} ${seen[b]}` : b;
    });
}

// ------------------------------------------------------------- formatting

function formatCell(raw, col, r) {
    raw = (raw ?? '').trim();
    if (raw === '') return '';
    if (col.type === 'number') {
        const v = col.values[r];
        if (v === null) return raw;
        if (col.format === 'year') return String(v);
        if (col.format === 'eng') return engFormat(v);
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
    const arrays = [], floors = [];
    for (let c = 0; c < state.cols.length; c++) {
        ctx.font = `bold ${font}`;
        // 14px ≈ the sort-arrow slot in the header
        floors.push(Math.max(MIN_COL,
            Math.ceil(ctx.measureText(state.cols[c].name).width) + 14 + CELL_PAD));
        ctx.font = font;
        const w = [];
        for (let r = 0; r < state.rows.length; r++) {
            const text = state.formatted[r][c];
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

// ------------------------------------------------------------------ state

const state = {
    fileName: '',
    headers: [],
    rows: [],          // raw string cells
    cols: [],          // inference results, parallel to headers
    formatted: [],     // formatted display strings, parallel to rows
    searchRaw: [],     // concatenated row text (formatted + raw) per row
    searchLow: [],     // lower-cased version, for case-insensitive terms
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
    const terms = parseQuery(state.globalFilter);
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
    const { cols, view, formatted } = state;
    const cap = state.showAll ? view.length : Math.min(view.length, RENDER_CAP);
    const parts = [];
    for (let i = 0; i < cap; i++) {
        const r = view[i];
        const cells = cols.map((col, c) => {
            const text = formatted[r][c];
            if (text === '') return `<td class="col-${col.type} blank">·</td>`;
            return `<td class="col-${col.type}">${escapeHtml(text)}</td>`;
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
        `${state.fileName ? state.fileName + ' — ' : ''}${counts} × ${state.cols.length} cols`
        + (state.guessedHeaders ? ' (headers guessed)' : '');
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

/* headerOverride: null = auto-detect, true = force row 1 as header,
 * false = force headerless (guessed names). */
function loadText(text, fileName, headerOverride = null) {
    try {
        text = cleanCsvText(text);
        if (!text.trim()) throw new Error('No data found.');
        const delim = sniffDelimiter(text);
        const all = parseCSV(text, delim);
        if (all.length < 2) throw new Error('Need a header row and at least one data row.');
        const headerless = headerOverride === null ? looksHeaderless(all[0]) : !headerOverride;
        const headers = headerless
            ? all[0].map((_, i) => `col${i + 1}`)
            : all[0].map((h, i) => h.trim() || `col${i + 1}`);
        const rows = (headerless ? all : all.slice(1)).map(r => {
            // normalize ragged rows to header length
            if (r.length === headers.length) return r;
            const out = r.slice(0, headers.length);
            while (out.length < headers.length) out.push('');
            return out;
        });
        const cols = inferColumns(headers, rows);
        if (headerless) guessHeaders(cols);
        state.rawText = text;             // kept for the header toggle
        state.fileName = fileName || '';
        state.guessedHeaders = headerless;
        state.headers = cols.map(c => c.name);
        state.rows = rows;
        state.cols = cols;
        state.formatted = rows.map((row, r) => cols.map((col, c) => formatCell(row[c], col, r)));
        state.searchRaw = state.formatted.map(
            (frow, r) => frow.join(' ') + ' ' + rows[r].join(' '));
        state.searchLow = state.searchRaw.map(s => s.toLowerCase());
        state.sortCol = null;
        state.sortDir = 1;
        state.globalFilter = '';
        state.colFilters = new Array(headers.length).fill('');
        state.manualWidths = new Map();
        state.showAll = false;

        $('global-filter').value = '';
        $('ingest-error').classList.add('d-none');
        $('ingest-view').classList.add('d-none');
        $('table-view').classList.remove('d-none');
        $('toolbar').classList.remove('d-none');
        $('header-btn').classList.toggle('active', !headerless);
        renderHead();
        state.layout = measureLayout();   // frozen for this load
        applyLayout();
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
    $('show-all-btn').addEventListener('click', () => { state.showAll = true; renderBody(); });
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
    $('version').textContent = 'v' + VERSION;
    $('header-version').textContent = 'v' + VERSION;
    initEvents();
    initPWA();
    const src = new URLSearchParams(location.search).get('src');
    if (src) loadFromUrl(src);
});
