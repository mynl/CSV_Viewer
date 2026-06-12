/* csv-grid util — pure display logic, no DOM: formatting (auto rules +
 * format specs), fzf search, column filters, equal-risk width solver.
 * ES module imported by grid.js and the smoke test; data logic (parse,
 * inference) lives in core.js. Everything here must stay side-effect-free.
 */

import { engFormat, parseNumber, parseDate, inferColumns } from './core.js';

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
export function parseFormatSpec(spec) {
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
export function formatWithSpec(v, f) {
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
export function parseAlignSpec(s) {
    return [...s].map(ch => ({ l: 'left', r: 'right', c: 'center' }[ch] ?? null));
}

export function formatCell(raw, col, r) {
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
export function normalizeRecords(records, columns) {
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
export function parseQuery(q) {
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
export function fuzzyScore(needle, hay) {
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
export function termScore(t, rowLow, rowRaw) {
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

export const CELL_PAD = 18;     // padding + border + safety, px
export const MIN_COL = 50;      // absolute floor, px

/* Allocate column widths into `avail` px. Tight (every cell fully visible)
 * if it fits; otherwise the equal-risk VaR rule: bisect for the single
 * percentile q such that the per-column q-th percentile widths (floored)
 * sum to avail — every column truncates with the same probability 1 - q.
 * `arrays` must be sorted ascending. */
export function solveWidths(arrays, floors, avail) {
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
export function sampleIndices(n, k) {
    if (n <= k) return Array.from({ length: n }, (_, i) => i);
    const out = new Array(k);
    const stride = n / k;
    for (let i = 0; i < k; i++) out[i] = Math.floor(i * stride);
    return out;
}

// ------------------------------------------------------------- filtering

/* Build a predicate from a per-column filter string. Number/date columns
 * support >x >=x <x <=x =x and a..b ranges; otherwise substring match. */
export function makeColPredicate(filter, col) {
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
export function cellClass(col) {
    return col.align ? `col-${col.type} align-${col.align}` : `col-${col.type}`;
}

export function escapeHtml(s) {
    return s.replace(/&/g, '&amp;').replace(/</g, '&lt;')
            .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
