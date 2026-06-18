/* csv-grid core — pure data logic, no DOM.
 *
 * ES module, imported by util.js / grid.js (page side) and worker.js
 * (worker side). Everything here must stay DOM-free and side-effect-free.
 * Pure display logic (formatting, search, widths) lives in util.js, the
 * CsvGrid component in grid.js, viewer chrome in src/app/app.js.
 */

// ---------------------------------------------------------------- parsing

/* Strip a UTF-8 BOM and leading blank/whitespace-only lines — bank
 * downloads often have both, and a leading blank line otherwise makes the
 * file look single-column. */
export function cleanCsvText(text) {
    return (text ?? '').replace(/^\uFEFF/, '').replace(/^(?:[ \t]*(?:\r\n|\n|\r))+/, '');
}

/* Sniff the delimiter from the first ~20 lines: the candidate with the
 * highest, most consistent per-line field count (> 1) wins. */
export function sniffDelimiter(text) {
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
export function parseCSV(text, delim) {
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

// --------------------------------------------------- markdown pipe tables

/* Split a markdown table row: optional outer pipes, cells split on |,
 * honoring escaped \| inside a cell. */
export function splitMdRow(line) {
    line = line.trim();
    if (line.startsWith('|')) line = line.slice(1);
    if (line.endsWith('|') && !line.endsWith('\\|')) line = line.slice(0, -1);
    const cells = [];
    let cur = '';
    for (let i = 0; i < line.length; i++) {
        const ch = line[i];
        if (ch === '\\' && line[i + 1] === '|') { cur += '|'; i++; }
        else if (ch === '|') { cells.push(cur); cur = ''; }
        else cur += ch;
    }
    cells.push(cur);
    return cells.map(c => c.trim());
}

const MD_ALIGN_CELL_RE = /^:?-+:?$/;

/* A markdown table = first non-blank line has a pipe, second is an
 * alignment separator row (every cell like ---, :--, :-:, --:). */
export function isMarkdownTable(text) {
    const lines = text.split(/\r\n|\n|\r/).filter(l => l.trim() !== '');
    if (lines.length < 2 || !lines[0].includes('|')) return false;
    const sep = splitMdRow(lines[1]);
    return sep.length > 0 && sep.every(c => MD_ALIGN_CELL_RE.test(c));
}

/* Returns {headers, rows, aligns}; aligns[i] is 'left' | 'center' |
 * 'right' | null (null = keep the viewer's type-based alignment). */
export function parseMarkdownTable(text) {
    const lines = text.split(/\r\n|\n|\r/).filter(l => l.trim() !== '');
    const headers = splitMdRow(lines[0]).map((h, i) => h || `col${i + 1}`);
    const aligns = splitMdRow(lines[1]).map(c => {
        const l = c.startsWith(':'), r = c.endsWith(':');
        return l && r ? 'center' : r ? 'right' : l ? 'left' : null;
    });
    while (aligns.length < headers.length) aligns.push(null);
    const rows = lines.slice(2).filter(l => l.includes('|')).map(r => {
        const out = splitMdRow(r).slice(0, headers.length);
        while (out.length < headers.length) out.push('');
        return out;
    });
    return { headers, rows, aligns };
}

// --------------------------------------------------------- type inference

// Currency battery: USD, GBP, EUR, ¥ (yen AND yuan — shared glyph), plus the
// full-width CJK variant ￥ (U+FFE5). A value carrying any of these is money.
export const CUR_RE = /[$£€¥￥]/;
// A number: optional accounting parens, then a sign and a currency symbol in
// EITHER order (each optional), grouped digits / bare-dot float, optional
// exponent, optional trailing %. Either-order sign+symbol fixes -$100.
const NUM_RE = /^\(?(?:[+-]?[$£€¥￥]?|[$£€¥￥][+-]?)(?:[0-9][0-9,]*(?:\.[0-9]+)?|\.[0-9]+)(?:[eE][+-]?[0-9]+)?%?\)?$/;
// ±infinity, any common spelling: inf / infinity / ∞ / Infinity (JS String()
// of a float64 inf, via the python payload), optional sign, accounting parens.
const INF_RE = /^\(?[+-]?(?:inf(?:inity)?|∞)\)?$/i;
const ISO_RE = /^(\d{4})-(\d{1,2})-(\d{1,2})(?:[T ](\d{1,2}):(\d{2})(?::(\d{2})(?:\.\d+)?)?Z?)?$/;
const NUMDATE_RE = /^(\d{1,4})([\/\-.])(\d{1,2})\2(\d{1,4})$/;
const DMON_RE = /^(\d{1,2})[ \-]([A-Za-z]{3,9})\.?,?[ \-](\d{2,4})$/;   // 5 Jan 2024, 05-Jan-24
const MOND_RE = /^([A-Za-z]{3,9})\.?,?[ \-](\d{1,2}),?[ \-](\d{2,4})$/; // Jan 5, 2024
const MONTH_NAMES = ['january', 'february', 'march', 'april', 'may', 'june',
    'july', 'august', 'september', 'october', 'november', 'december'];

/* Null tokens: strings that mean "missing", not data. Treated like blanks
 * by inference (never count toward or against a type, never demote a
 * numeric/date column) and rendered as empty cells by formatCell. A small,
 * conservative, documented list — no fuzzy threshold. Compared on the
 * trimmed, lower-cased string. */
const NULL_TOKENS = new Set(['nan', 'na', 'n/a', '#n/a', 'null', 'none', '-', '--', '.']);
export function isNullToken(s) {
    return NULL_TOKENS.has((s ?? '').trim().toLowerCase());
}

/* Parse a number: thousands commas, (123) negatives, a currency symbol from
 * the battery ($£€¥￥, on either side of the sign), trailing %, scientific
 * notation (1e-03), bare leading-dot floats (.5), and ±infinity.
 * Returns {v, dec, sym} or null; sym is the currency glyph ('' if none). */
export function parseNumber(s) {
    s = s.trim();
    // ±∞ is a legitimate float64 value (e.g. an infinite moment); keep it as
    // the number it is so the column infers numeric, not text. dec: 0 so it
    // never inflates the column's decimal count.
    if (INF_RE.test(s)) {
        let t = s;
        if (t.startsWith('(') && t.endsWith(')')) t = '-' + t.slice(1, -1);
        return { v: t.startsWith('-') ? -Infinity : Infinity, dec: 0 };
    }
    if (!NUM_RE.test(s)) return null;
    let neg = false;
    if (s.startsWith('(') && s.endsWith(')')) { neg = true; s = s.slice(1, -1); }
    // capture the currency symbol wherever it sits (before or after the sign)
    // and strip it; the bare number is parsed below, the symbol returned for
    // display. The leading sign stays in `s` for parseFloat and dec counting.
    let sym = '';
    const cm = CUR_RE.exec(s);
    if (cm) { sym = cm[0]; s = s.replace(CUR_RE, ''); }
    let pct = false;
    if (s.endsWith('%')) { pct = true; s = s.slice(0, -1); }
    s = s.replace(/,/g, '');
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
    return { v, dec, sym };
}

/* True if `s` is an integer-form token whose magnitude exceeds 2^53, so
 * float64 cannot hold it exactly (parseNumber would silently round it, and
 * distinct big values can collapse to the same double — data corruption,
 * not formatting). Such a column is kept as TEXT so the digits survive
 * verbatim. Integer-form only: a '.' or exponent means an inherently
 * approximate float, which stays a number. Pure lexical test — no BigInt:
 * <= 15 digits is always safe (10^15 < 2^53), 16 digits needs one string
 * compare against MAX_SAFE_INTEGER, 17+ is always unsafe. */
const MAX_SAFE_DIGITS = '9007199254740991';   // Number.MAX_SAFE_INTEGER, 2^53 - 1
export function isUnsafeBigInt(s) {
    s = s.trim();
    if (s.endsWith('%')) return false;                  // a percent is a fraction
    if (s.startsWith('(') && s.endsWith(')')) s = s.slice(1, -1);   // (123) negative
    s = s.replace(/[$£€¥￥,]/g, '').replace(/^[+-]/, '');
    if (!/^\d+$/.test(s)) return false;                 // not integer-form (has . or e, or junk)
    s = s.replace(/^0+(?=\d)/, '');                     // ignore leading zeros for magnitude
    return s.length > 16 || (s.length === 16 && s > MAX_SAFE_DIGITS);
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
export function parseDate(s, dayFirst = false) {
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

/* Classify an all-numeric date's order signal:
 *   'day'       — first part > 12, so it must be day-first (13/05/2024)
 *   'month'     — second part > 12, so it must be month-first (05/13/2024)
 *   'ambiguous' — both parts <= 12: order is genuinely unknowable (05/01/2024)
 *   null        — not the ambiguous 2-digit d/m/y form (ISO-ish y/m/d, or
 *                 not a numeric triple at all)
 * Drives both the per-column day-first decision and the A5 ambiguity note. */
function numDateOrder(s) {
    const m = NUMDATE_RE.exec(s.trim());
    if (!m) return null;
    const a = m[1], b = m[3], c = m[4];
    if (a.length === 4) return null;                          // y/m/d, unambiguous
    if (!(c.length === 4 || c.length === 2)) return null;     // not a d/m/y or m/d/y year
    if (+a > 12 && +b <= 12) return 'day';
    if (+b > 12 && +a <= 12) return 'month';
    if (+a <= 12 && +b <= 12) return 'ambiguous';
    return null;
}

/* True if this value pins the ambiguous numeric form to day-first. */
export function dateNeedsDayFirst(s) {
    return numDateOrder(s) === 'day';
}

/* Headerless detection (bank-export style): the first row is data, not
 * headers, if any cell parses as a number or a date — real headers are
 * text. All-text files are ambiguous and keep first-row-as-header. */
export function looksHeaderless(firstRow) {
    return firstRow.some(c => {
        const s = (c ?? '').trim();
        return s !== '' && (parseNumber(s) !== null || parseDate(s) !== null);
    });
}

/* Name guessed columns by inferred type: Date / Amount / Description
 * (Year for year-formatted integers), numbered when a type repeats.
 * Mutates col.name in place. */
export function guessHeaders(cols) {
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

const YEAR_TITLE_RE = /\b(year|yr|vintage|cohort)\b/i;
const MONEY_TITLE_RE = /\b(amount|amt|balance|bal|price|cost|fee|fees|charge|paid|payment|debit|credit|total|premium|loss|salary|wage|income|expense|revenue|usd|gbp|eur|cad)\b|[$£€]/i;
/* Identifier-ish headers: integer columns that are codes/keys, not
 * quantities, so they get NO thousands separators (account 100200, not
 * 100,200). Header text only — no value heuristics (author's call). */
const ID_TITLE_RE = /\b(id|no|num|number|account|acct|code|zip|postal|phone|fax|ssn|ein|tin|invoice|inv|ref|reference|sku|upc|isbn|order|customer|cust|member|policy|claim|seq)\b/i;
/* Ratio/rate headers (ROE, loss ratio, combined ratio, yield, …): a float
 * column stored as a fraction is shown as a percentage (0.625 -> 62.5%).
 * Letter-only boundaries (?<![a-z])…(?![a-z]) — NOT \b — so the word is
 * found inside snake_case / digits too (loss_ratio, lr3) while short tokens
 * (lr, roe, coc) don't bleed into longer words. A value gate (max|x| <= 2)
 * in classifyNumber, not the name, is the real guard against false hits. */
const PERCENT_TITLE_RE = /(?<![a-z])(ratio|rate|roe|roa|coc|lr|elr|plr|margin|yield|return|growth|retention|cede|ceded|discount|apr|apy|coupon|util|utilization|share|pct|percent|frequency)(?![a-z])/i;

/* Choose a numeric column's display format (greater_tables rules):
 *   year  — integers, header says year-ish OR all values in (1800, 2030);
 *           plain, no commas
 *   int   — all integer-valued; commas, no decimals
 *   eng   — floats spanning > 6 orders of magnitude; engineering format
 *   float — uniform decimals d = clamp(min(maxObservedDecimals,
 *           3 - floor(log10(mean|x| over nonzero))), 0, 6): ~4 significant
 *           digits at the column's typical magnitude, never more precision
 *           than the raw data carried. Money (by header, by value when
 *           <= 2dp observed and max < 100,000, or by a currency symbol on the
 *           values) trumps with exactly 2dp. */
export function classifyNumber(name, values, maxDec, hasCurrency = false) {
    // a currency symbol on the values means money, full stop: 2dp, beating
    // every header rule below (a $ value is money even if the header says
    // "year" or looks like an id).
    if (hasCurrency) return { format: 'float', dec: 2 };
    const xs = values.filter(v => v !== null);
    const allInt = xs.every(v => Number.isInteger(v));
    if (allInt && xs.length) {
        // year range inclusive 1800–2100: projection columns run decades ahead
        const yearish = YEAR_TITLE_RE.test(name) || xs.every(v => v >= 1800 && v <= 2100);
        if (yearish) return { format: 'year', dec: 0 };
        // identifier (account/policy/order no.) that is NOT also a money
        // column -> plain integer, no separators. Money words win the
        // overlap ("Order Amount", "Account Balance") -> 2dp below.
        if (ID_TITLE_RE.test(name) && !MONEY_TITLE_RE.test(name)) return { format: 'plain', dec: 0 };
        // money by title trumps everything below (author: "deffo 2dp")
        if (MONEY_TITLE_RE.test(name)) return { format: 'float', dec: 2 };
        return { format: 'int', dec: 0 };
    }
    // floats (the all-integer block above always returns). Compute magnitude
    // stats once via a loop, not Math.max(...spread) (a 250K spread blows the
    // stack), so the percent value-gate and the rules below can share them.
    let nNz = 0, maxAbs = 0, minAbs = Infinity, sum = 0;
    for (const v of xs) {
        // finite values only: a stray ±∞ must not make maxAbs Infinity (that
        // would trip the eng span test and mislabel a normal column).
        if (v === 0 || !Number.isFinite(v)) continue;
        const a = Math.abs(v);
        nNz++;
        if (a > maxAbs) maxAbs = a;
        if (a < minAbs) minAbs = a;
        sum += a;
    }
    if (!nNz) return { format: 'float', dec: Math.min(maxDec, 6) };
    // ratio/rate column stored as a fraction -> percent. Gated to |x| <= 2
    // (<= 200%): the author expects values in ~ -1..2, not floored at 0; a
    // column already in percentage points (rate 62) must NOT become 6,200%.
    // Ranks ABOVE money so "loss ratio" isn't grabbed by 'loss'. Uniform
    // decimals = the precision the data carried, less the two places ×100
    // shifts (clamped 1..4): 0.625(3dp) -> 62.5%, 0.1523(4dp) -> 15.23%.
    if (PERCENT_TITLE_RE.test(name) && maxAbs <= 2) {
        return { format: 'pct', dec: Math.max(1, Math.min(4, maxDec - 2)) };
    }
    // money by title trumps the rest (author: "deffo 2dp")
    if (MONEY_TITLE_RE.test(name)) return { format: 'float', dec: 2 };
    // money by value: ≤ 2 observed decimals and everything under 100,000
    if (maxDec <= 2 && maxAbs < 1e5) return { format: 'float', dec: 2 };
    if (maxAbs / minAbs > 1e6) return { format: 'eng', dec: 0 };
    const meanAbs = sum / nNz;
    const dec = Math.max(0, Math.min(maxDec, 3 - Math.floor(Math.log10(meanAbs)), 6));
    return { format: 'float', dec };
}

/* Engineering format, 3 significant digits, SI suffixes n..T. */
const ENG_SUFFIX = { '-9': 'n', '-6': 'µ', '-3': 'm', 0: '', 3: 'k', 6: 'M', 9: 'G', 12: 'T' };

export function engFormat(v) {
    if (!Number.isFinite(v)) return v > 0 ? 'inf' : '-inf';
    if (v === 0) return '0';
    const a = Math.abs(v);
    let e = Math.floor(Math.log10(a) / 3) * 3;
    e = Math.max(-9, Math.min(12, e));
    const m = a / 10 ** e;
    return (v < 0 ? '-' : '') + Number(m.toPrecision(3)) + ENG_SUFFIX[e];
}

/* Deterministic stride sample of k indices from 0..n-1 (all of them when
 * n <= k). Used both for the column type decision below and (in util.js)
 * for the width-percentile sample — a few thousand evenly-spaced rows pin
 * a column's character down fine without touching every cell. */
export function sampleIndices(n, k) {
    if (n <= k) return Array.from({ length: n }, (_, i) => i);
    const out = new Array(k);
    const stride = n / k;
    for (let i = 0; i < k; i++) out[i] = Math.floor(i * stride);
    return out;
}

const INFER_SAMPLE = 2048;          // rows sampled for the column type decision
const LEADING_ZERO_RE = /^-?0\d/;   // 007, 01234 — a significant leading zero (code, not a number; excludes 0, 0.5)

/* Classify each column as number / date / text. The TYPE decision is made
 * from a stride sample of up to INFER_SAMPLE rows: a lone oddball deep in a
 * large file no longer demotes an otherwise-clean numeric/date column — the
 * stray cell is left unparsed (value null) and renders raw via formatCell,
 * so data is never hidden. For files <= INFER_SAMPLE rows the sample is
 * every row, so behavior is unchanged. Blanks and null tokens (NaN/NA/…)
 * never count toward or against a type. A column with a significant leading
 * zero (007) is forced to text so the zero survives. The typed values array
 * is then built over ALL rows. */
export function inferColumns(headers, rows) {
    const sample = sampleIndices(rows.length, INFER_SAMPLE);
    return headers.map((name, c) => {
        // --- type decision, from the sample only
        let isNum = true, isDate = true, leadingZero = false, bigInt = false, seen = 0;
        for (const r of sample) {
            const raw = (rows[r][c] ?? '').trim();
            if (raw === '' || isNullToken(raw)) continue;
            seen++;
            if (isNum) {
                // a value that parses as a number but carries a significant
                // leading zero (007) is a code, not a quantity -> force text.
                // Gated to numeric values so zero-padded dates/times (05/01,
                // 09:30) are NOT misread as codes.
                if (parseNumber(raw) === null) isNum = false;
                else {
                    if (!leadingZero && LEADING_ZERO_RE.test(raw)) leadingZero = true;
                    // integer past 2^53 -> float64 loses digits; keep the
                    // column text so the exact value survives (D1)
                    if (!bigInt && isUnsafeBigInt(raw)) bigInt = true;
                }
            }
            if (isDate && parseDate(raw, false) === null) isDate = false;
            if (leadingZero || bigInt || (!isNum && !isDate)) break;   // result is text; nothing more can change it
        }
        // big-int columns read as numbers though stored as text -> right-align;
        // an ordinary leading-zero/text column keeps its default left-align
        if (seen === 0 || leadingZero || bigInt) {
            return bigInt
                ? { name, type: 'text', align: 'right', values: null }
                : { name, type: 'text', values: null };
        }

        // --- build typed values over ALL rows (a non-sampled cell that
        // doesn't parse stays null -> renders raw, never demotes the column)
        if (isNum) {
            const numv = new Array(rows.length).fill(null);
            let maxDec = 0, hasCurrency = false;
            for (let r = 0; r < rows.length; r++) {
                const raw = (rows[r][c] ?? '').trim();
                if (raw === '' || isNullToken(raw)) continue;
                const p = parseNumber(raw);
                if (p) {
                    numv[r] = p.v;
                    if (p.dec > maxDec) maxDec = p.dec;
                    if (p.sym) hasCurrency = true;   // any symbol anywhere -> money column
                }
            }
            const cls = classifyNumber(name, numv, maxDec, hasCurrency);
            return { name, type: 'number', format: cls.format, dec: cls.dec,
                     hasCurrency, values: numv };
        }
        if (isDate) {
            // parse month-first; track the day-first signal and whether the
            // all-numeric order was ever pinned by data (A5 ambiguity note)
            let dayFirst = false, hasTime = false, sawAmbiguous = false, forced = false;
            let datev = new Array(rows.length).fill(null);
            for (let r = 0; r < rows.length; r++) {
                const raw = (rows[r][c] ?? '').trim();
                if (raw === '' || isNullToken(raw)) continue;
                const p = parseDate(raw, false);
                if (p) { datev[r] = p.t; hasTime = hasTime || p.hasTime; }
                const ord = numDateOrder(raw);
                if (ord === 'day') { dayFirst = true; forced = true; }
                else if (ord === 'month') forced = true;
                else if (ord === 'ambiguous') sawAmbiguous = true;
            }
            if (dayFirst) {
                // re-parse the whole column day-first (rare: UK-style data)
                datev = new Array(rows.length).fill(null);
                for (let r = 0; r < rows.length; r++) {
                    const raw = (rows[r][c] ?? '').trim();
                    if (raw === '' || isNullToken(raw)) continue;
                    const p = parseDate(raw, true);
                    if (p) datev[r] = p.t;
                }
            }
            // ambiguous iff we saw an unknowable all-numeric value and nothing
            // anywhere in the column pinned the order
            return { name, type: 'date', hasTime, ambiguousOrder: sawAmbiguous && !forced, values: datev };
        }
        return { name, type: 'text', values: null };
    });
}

// -------------------------------------------------------- entry point

/* Full data pipeline on cleaned text: markdown-vs-CSV decision, parse,
 * header detection (headerOverride: null = auto, true = row 1 is header,
 * false = headerless), inference, guessed names, md alignment overrides.
 * Pure and DOM-free — runs synchronously on the page for small inputs and
 * inside the worker for large ones. Throws on unusable input. */
export function processData(text, headerOverride = null) {
    let headers, rows, aligns = null, headerless;
    if (isMarkdownTable(text)) {
        ({ headers, rows, aligns } = parseMarkdownTable(text));
        headerless = headerOverride === false;   // md tables are headed by definition
        if (headerless) {
            rows = [headers, ...rows];
            headers = headers.map((_, i) => `col${i + 1}`);
        }
        if (!rows.length) throw new Error('Markdown table has no data rows.');
    } else {
        const delim = sniffDelimiter(text);
        const all = parseCSV(text, delim);
        if (all.length < 2) throw new Error('Need a header row and at least one data row.');
        headerless = headerOverride === null ? looksHeaderless(all[0]) : !headerOverride;
        headers = headerless
            ? all[0].map((_, i) => `col${i + 1}`)
            : all[0].map((h, i) => h.trim() || `col${i + 1}`);
        rows = (headerless ? all : all.slice(1)).map(r => {
            // normalize ragged rows to header length
            if (r.length === headers.length) return r;
            const out = r.slice(0, headers.length);
            while (out.length < headers.length) out.push('');
            return out;
        });
    }
    const cols = inferColumns(headers, rows);
    if (headerless) guessHeaders(cols);
    if (aligns) cols.forEach((c, i) => { if (aligns[i]) c.align = aligns[i]; });
    return { headers: cols.map(c => c.name), rows, cols, headerless };
}
