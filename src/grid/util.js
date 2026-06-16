/* csv-grid util — pure display logic, no DOM: formatting (auto rules +
 * format specs), fzf search, column filters, equal-risk width solver.
 * ES module imported by grid.js and the smoke test; data logic (parse,
 * inference) lives in core.js. Everything here must stay side-effect-free.
 */

import { engFormat, parseNumber, parseDate, inferColumns, isNullToken } from './core.js';

// sampleIndices lives in core.js (inference uses it too); re-exported here
// so existing importers (grid.js, the smoke test) keep their import path.
export { sampleIndices } from './core.js';

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
        // unparsed cell in a numeric column: blank a null token (NaN/NA),
        // else show it raw (a stray non-numeric value, never hidden)
        if (v === null) return isNullToken(raw) ? '' : raw;
        if (col.fmt) return formatWithSpec(v, col.fmt);   // explicit spec wins
        if (col.format === 'year' || col.format === 'plain') return String(v);
        if (col.format === 'eng') return engFormat(v);
        return numberFormatter(col.dec).format(v);
    }
    if (col.type === 'date') {
        const t = col.values[r];
        if (t === null) return isNullToken(raw) ? '' : raw;
        const d = new Date(t);
        const pad = x => String(x).padStart(2, '0');
        let s = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
        if (col.hasTime) s += ` ${pad(d.getHours())}:${pad(d.getMinutes())}`;
        return s;
    }
    return raw;
}

// -------------------------------------------------------- export serializers

/* RFC 4180 CSV. A field is quoted iff it contains a quote, comma, CR or LF;
 * embedded quotes are doubled. CRLF line endings (Excel-friendly). Cells
 * stringify; null/undefined -> ''. Headers are row 1. (The UTF-8 BOM for
 * file saves is added by the caller, not here — clipboard copies omit it.) */
export function toCSV(headers, rows2d) {
    const q = s => {
        s = (s ?? '') + '';
        return /[",\r\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
    };
    const line = cells => cells.map(q).join(',');
    const out = [line(headers)];
    for (const row of rows2d) out.push(line(row));
    return out.join('\r\n');
}

/* GitHub-flavored markdown pipe table. `aligns[i]` is 'left'|'center'|
 * 'right' (anything else -> no alignment marker); the separator row encodes
 * it (:-- / :-: / --:). Embedded pipes are escaped, newlines collapse to a
 * space (a cell can't span table rows). Outer pipes included. */
export function toMarkdown(headers, rows2d, aligns = []) {
    const esc = s => ((s ?? '') + '').replace(/\|/g, '\\|').replace(/\s*\r?\n\s*/g, ' ');
    const sep = a => a === 'right' ? '---:' : a === 'center' ? ':--:' : a === 'left' ? ':---' : '---';
    const line = cells => '| ' + cells.map(esc).join(' | ') + ' |';
    // delimiter row compact, no inner spaces — some parsers (e.g. Sublime)
    // only recognize alignment markers in the form |:---|---:|
    const delim = '|' + headers.map((_, i) => sep(aligns[i])).join('|') + '|';
    const out = [line(headers), delim];
    for (const row of rows2d) out.push(line(row));
    return out.join('\n');
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

/* Allocate column widths into `avail` px. Two selectable modes (the
 * `mode` argument; `widthMode` option on the grid). Both share the trivial
 * regimes — tight (every cell fully visible) when it all fits, floors +
 * horizontal scroll when nothing does — and differ only in the squeeze.
 * `arrays` must be sorted ascending. */
export function solveWidths(arrays, floors, avail, mode = 'equal-risk') {
    return mode === 'coverage'
        ? coverageWidths(arrays, floors, avail)
        : equalRiskWidths(arrays, floors, avail);
}

/* Equal-risk (VaR) squeeze: bisect for the single percentile q such that
 * the per-column q-th percentile widths (floored) sum to avail — every
 * column truncates with the same probability 1 - q. */
function equalRiskWidths(arrays, floors, avail) {
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

/* Coverage squeeze: maximize the total number of cells shown in full,
 *   max Σ_j F_j(w_j)  s.t.  Σ w_j ≤ avail,  floor_j ≤ w_j ≤ natural_j,
 * where F_j is column j's empirical cell-width CDF. Completes cheap
 * thin-tail columns to 100% and concentrates truncation on the few
 * expensive thick-tail outliers (the right cells to drop). Greedy
 * water-fill: every column starts at its floor, then budget is spent on
 * the steepest available marginal slope (cells gained per px) first.
 * Greedy is optimal only on a concave curve, so each column contributes
 * the segments of its UPPER CONCAVE ENVELOPE (slopes strictly decreasing);
 * pooling those globally and buying by slope respects per-column order for
 * free. Equalizes the marginal cells/px at a cutoff slope λ. */
function coverageWidths(arrays, floors, avail) {
    const natural = arrays.map((s, j) => Math.max(floors[j], s.length ? s[s.length - 1] : 0));
    const sum = a => a.reduce((x, y) => x + y, 0);
    if (sum(natural) <= avail) return natural;            // tight: everything fits
    if (sum(floors) >= avail) return floors.slice();      // floors + scroll

    const widths = floors.slice();
    let budget = avail - sum(floors);
    const segs = [];
    for (let j = 0; j < arrays.length; j++) {
        const env = concaveEnvelope(arrays[j], floors[j]);
        for (let i = 1; i < env.length; i++) {
            const dw = env[i].w - env[i - 1].w;
            const dc = env[i].cells - env[i - 1].cells;
            if (dw > 0 && dc > 0) segs.push({ j, dw, slope: dc / dw });
        }
    }
    segs.sort((a, b) => b.slope - a.slope);
    for (const s of segs) {
        if (budget <= 0) break;
        const buy = Math.min(s.dw, budget);    // partial buy is fine — width is continuous
        widths[s.j] += buy;
        budget -= buy;
    }
    return widths;
}

/* Upper concave envelope of a column's (width, cumulative-cells-shown)
 * step curve, starting at the floor (cells already shown for free at the
 * header-driven minimum). Returns vertices with strictly decreasing slope
 * — the efficient frontier the water-fill buys along. `sorted` ascending. */
function concaveEnvelope(sorted, floor) {
    const n = sorted.length;
    let i = 0;
    while (i < n && sorted[i] <= floor) i++;        // free cells at the floor
    const pts = [{ w: floor, cells: i }];
    while (i < n) {                                 // one vertex per distinct width
        const w = sorted[i];
        while (i < n && sorted[i] === w) i++;
        pts.push({ w, cells: i });
    }
    const hull = [];
    for (const p of pts) {
        while (hull.length >= 2) {
            const a = hull[hull.length - 2], b = hull[hull.length - 1];
            // drop b unless it is a strict concave vertex (clockwise turn)
            const cross = (b.w - a.w) * (p.cells - a.cells) - (b.cells - a.cells) * (p.w - a.w);
            if (cross >= 0) hull.pop(); else break;
        }
        hull.push(p);
    }
    return hull;
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
