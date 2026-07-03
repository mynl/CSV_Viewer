/* csv-grid util — pure display logic, no DOM: formatting (auto rules +
 * format specs), fzf search, column filters, equal-risk width solver.
 * ES module imported by grid.js and the smoke test; data logic (parse,
 * inference) lives in core.js. Everything here must stay side-effect-free.
 */

import { engFormat, parseNumber, parseDate, inferColumns, isNullToken, CUR_RE } from './core.js';

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

/* Parse a format spec into a descriptor. `type` is the column's inferred
 * type ('number' | 'date' | 'text') so a spec can be validated against it.
 *
 * Number columns — subset of the Python/d3 mini-language: optional ','
 * (thousands), optional '.N' (decimals), one of f (fixed) d (integer)
 * % (x100, percent) e (scientific) s (SI suffix), plus the named specs
 * 'year' and 'eng'.
 *
 * Date columns — a strftime-style pattern (any spec containing '%' that is
 * not the bare percent number spec) -> { kind: 'datefmt', pattern }; this
 * overrides the auto finest-present rule. Tokens: see `strftime` below.
 *
 * null/'' = auto rules. A number spec on a date column (or a date pattern
 * on a number column) is an error. */
export function parseFormatSpec(spec, type) {
    if (spec === null || spec === undefined || spec === '') return null;
    // a strftime pattern carries a '%X' token (letter after %); the percent
    // number spec ('%', '.2%', ',.0%') has '%' only as the terminal kind, so
    // these never collide.
    const isDateFmt = /%[YymdHMSf%]/.test(spec);
    if (isDateFmt) {
        if (type === 'number') throw new Error(`CsvGrid: date format '${spec}' on a number column`);
        return { kind: 'datefmt', pattern: spec };
    }
    if (spec === 'year' || spec === 'eng') {
        if (type === 'date') throw new Error(`CsvGrid: number format '${spec}' on a date column`);
        return { kind: spec };
    }
    const m = /^(,)?(?:\.(\d+))?([fd%es])$/.exec(spec);
    if (!m) throw new Error(`CsvGrid: unrecognized format spec '${spec}'`);
    if (type === 'date') throw new Error(`CsvGrid: number format '${spec}' on a date column`);
    return { kind: m[3], comma: !!m[1], dec: m[2] === undefined ? null : +m[2] };
}

/* Minimal strftime for the date-format spec. Supported tokens:
 *   %Y 4-digit year   %y 2-digit year   %m month   %d day
 *   %H hour (24)      %M minute         %S second
 *   %f MILLISECONDS, 3 digits (NB: diverges from Python's %f = 6-digit
 *      microseconds — we cap resolution at ms, so %f is ms here)
 *   %% literal '%'
 * All other characters (including unknown %X) pass through literally.
 * Components are read in LOCAL time, matching the auto date rule. */
export function strftime(d, pattern) {
    const p2 = x => String(x).padStart(2, '0');
    return pattern.replace(/%([YymdHMSf%])/g, (_, c) => {
        switch (c) {
            case 'Y': return String(d.getFullYear());
            case 'y': return p2(d.getFullYear() % 100);
            case 'm': return p2(d.getMonth() + 1);
            case 'd': return p2(d.getDate());
            case 'H': return p2(d.getHours());
            case 'M': return p2(d.getMinutes());
            case 'S': return p2(d.getSeconds());
            case 'f': return String(d.getMilliseconds()).padStart(3, '0');
            case '%': return '%';
        }
    });
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

/* `mode`: 'auto' applies the type-aware display rules (separators, ISO
 * dates, percent, eng, …); 'raw' returns the verbatim trimmed source for
 * any non-blank cell (no rules at all) — the display lens. Type is the same
 * either way, so alignment (cellClass) and sort (col.values) are unaffected;
 * only the cell text changes. */
export function formatCell(raw, col, r, mode = 'auto') {
    raw = (raw ?? '').trim();
    if (raw === '') return '';
    if (mode === 'raw') return raw;
    if (col.type === 'number') {
        const v = col.values[r];
        // unparsed cell in a numeric column: blank a null token (NaN/NA),
        // else show it raw (a stray non-numeric value, never hidden)
        if (v === null) return isNullToken(raw) ? '' : raw;
        // ±∞ reads the same under every format, and Intl would render '∞';
        // show the literal text instead. Wins for float/money/pct/eng/year.
        if (!Number.isFinite(v)) return v > 0 ? 'inf' : '-inf';
        if (col.fmt) return formatWithSpec(v, col.fmt);   // explicit spec wins
        if (col.format === 'year' || col.format === 'plain') return String(v);
        if (col.format === 'eng') return engFormat(v);
        if (col.format === 'pct') return numberFormatter(col.dec).format(v * 100) + '%';
        const out = numberFormatter(col.dec).format(v);
        // currency column: re-attach the cell's own source glyph, after any
        // leading '-' (so ($100) and -$100 both render -$100.00). A bare cell
        // stays bare — the grid never ADDS a symbol, only keeps one that was
        // in the source. An explicit col.fmt returned earlier, so a spec
        // suppresses the symbol (the mini-language has no currency).
        if (col.hasCurrency) {
            const m = CUR_RE.exec(raw);
            if (m) return out[0] === '-' ? '-' + m[0] + out.slice(1) : m[0] + out;
        }
        return out;
    }
    if (col.type === 'date') {
        const t = col.values[r];
        if (t === null) return isNullToken(raw) ? '' : raw;
        const d = new Date(t);
        if (col.fmt?.kind === 'datefmt') return strftime(d, col.fmt.pattern);  // explicit wins
        const pad = x => String(x).padStart(2, '0');
        let s = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
        // finest-present auto rule (see inferColumns): day shows date only;
        // minute adds HH:MM; second adds :SS plus a uniform F-digit fraction
        // (F=0 -> none) taken from the leading digits of the 3-digit ms.
        const tp = col.timePrec ?? { level: col.hasTime ? 'minute' : 'day', frac: 0 };
        if (tp.level !== 'day') {
            s += ` ${pad(d.getHours())}:${pad(d.getMinutes())}`;
            if (tp.level === 'second') {
                s += `:${pad(d.getSeconds())}`;
                if (tp.frac > 0) {
                    const ms = String(d.getMilliseconds()).padStart(3, '0');
                    s += '.' + ms.slice(0, tp.frac);
                }
            }
        }
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

/* A grid `name` reduced to a safe download basename: a trailing extension
 * dropped, characters illegal on Windows/macOS/Linux and control chars
 * removed, trailing dots/spaces trimmed (Windows). Empty result -> the
 * caller's fallback. Extension is added back by the caller per format. */
export function safeFileName(name, fallback = 'file') {
    const n = (name || '')
        .replace(/\.[^.\\/]+$/, '')             // drop a trailing extension
        .replace(/[<>:"/\\|?*\x00-\x1f]/g, '')  // illegal on Win/mac/Linux
        .replace(/[. ]+$/, '')                  // no trailing dot/space (Windows)
        .trim();
    return n || fallback;
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

/* Natural-order sort key: a primitive string that sorts identically to
 * Intl.Collator('en', {sensitivity:'base', numeric:true}) for the cases CSV
 * text columns actually contain (case/accent folding + embedded integers
 * compared numerically), but lets the sort use plain `<` comparisons instead
 * of an Intl.Collator call per pair — ~10x faster, and built once per column
 * sort rather than O(n log n) times. Empty / whitespace-only cells yield ''
 * (the caller sorts those last, matching the prior collator path).
 *
 * Construction: trim, lower-case, strip combining accents (base sensitivity),
 * then rewrite each maximal digit run so a lexical compare reproduces a numeric
 * one — leading zeros dropped, then a one-char length prefix (more digits = a
 * larger integer) ahead of the digits; the \x01 marker keeps a numeric run
 * ordered before letters, as the collator does. Verified order-identical to the
 * live collator on the 250k text column (dev probe). */
export function makeSortKey(s) {
    s = (s ?? '').trim();
    if (s === '') return '';
    s = s.toLowerCase().normalize('NFKD').replace(/\p{Diacritic}/gu, '');
    return s.replace(/\d+/g, d => {
        d = d.replace(/^0+(?=\d)/, '');               // 007 -> 7, 000 -> 0
        return '\x01' + String.fromCharCode(d.length) + d;
    });
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
