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
export function parseNumber(s) {
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

/* True if this value pins the ambiguous numeric form to day-first. */
export function dateNeedsDayFirst(s) {
    const m = NUMDATE_RE.exec(s.trim());
    return !!m && m[1].length <= 2 && +m[1] > 12 && +m[3] <= 12;
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

/* Choose a numeric column's display format (greater_tables rules):
 *   year  — integers, header says year-ish OR all values in (1800, 2030);
 *           plain, no commas
 *   int   — all integer-valued; commas, no decimals
 *   eng   — floats spanning > 6 orders of magnitude; engineering format
 *   float — uniform decimals d = clamp(min(maxObservedDecimals,
 *           3 - floor(log10(mean|x| over nonzero))), 0, 6): ~4 significant
 *           digits at the column's typical magnitude, never more precision
 *           than the raw data carried. Money (by header, or by value when
 *           <= 2dp observed and max < 100,000) trumps with exactly 2dp. */
export function classifyNumber(name, values, maxDec) {
    const xs = values.filter(v => v !== null);
    const allInt = xs.every(v => Number.isInteger(v));
    if (allInt && xs.length) {
        // year range inclusive 1800–2100: projection columns run decades ahead
        const yearish = YEAR_TITLE_RE.test(name) || xs.every(v => v >= 1800 && v <= 2100);
        if (yearish) return { format: 'year', dec: 0 };
        // money by title trumps everything below (author: "deffo 2dp")
        if (MONEY_TITLE_RE.test(name)) return { format: 'float', dec: 2 };
        return { format: 'int', dec: 0 };
    }
    if (!allInt && MONEY_TITLE_RE.test(name)) return { format: 'float', dec: 2 };
    // loop, not Math.max(...spread): a 250K-element spread blows the stack
    let nNz = 0, maxAbs = 0, minAbs = Infinity, sum = 0;
    for (const v of xs) {
        if (v === 0) continue;
        const a = Math.abs(v);
        nNz++;
        if (a > maxAbs) maxAbs = a;
        if (a < minAbs) minAbs = a;
        sum += a;
    }
    if (!nNz) return { format: 'float', dec: Math.min(maxDec, 6) };
    // money by value: ≤ 2 observed decimals and everything under 100,000
    if (!allInt && maxDec <= 2 && maxAbs < 1e5) return { format: 'float', dec: 2 };
    if (maxAbs / minAbs > 1e6) return { format: 'eng', dec: 0 };
    const meanAbs = sum / nNz;
    const dec = Math.max(0, Math.min(maxDec, 3 - Math.floor(Math.log10(meanAbs)), 6));
    return { format: 'float', dec };
}

/* Engineering format, 3 significant digits, SI suffixes n..T. */
const ENG_SUFFIX = { '-9': 'n', '-6': 'µ', '-3': 'm', 0: '', 3: 'k', 6: 'M', 9: 'G', 12: 'T' };

export function engFormat(v) {
    if (v === 0) return '0';
    const a = Math.abs(v);
    let e = Math.floor(Math.log10(a) / 3) * 3;
    e = Math.max(-9, Math.min(12, e));
    const m = a / 10 ** e;
    return (v < 0 ? '-' : '') + Number(m.toPrecision(3)) + ENG_SUFFIX[e];
}

/* Classify each column over its non-blank values: number if all parse as
 * numbers, else date if all parse as dates, else text. Strict
 * all-or-nothing — needs every cell, which is why this runs in the worker
 * for large files. */
export function inferColumns(headers, rows) {
    return headers.map((name, c) => {
        let isNum = true, isDate = true, maxDec = 0, seen = 0;
        let dayFirst = false, hasTime = false;
        const numv = new Array(rows.length).fill(null);
        let datev = new Array(rows.length).fill(null);
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
                // parse month-first; matchability is convention-independent,
                // so one parse decides candidacy. Track the day-first signal.
                const p = parseDate(raw, false);
                if (p) {
                    datev[r] = p.t;
                    hasTime = hasTime || p.hasTime;
                    if (!dayFirst && dateNeedsDayFirst(raw)) dayFirst = true;
                } else isDate = false;
            }
            if (!isNum && !isDate) break;
        }
        if (seen === 0) return { name, type: 'text', values: null };
        if (isNum) {
            const cls = classifyNumber(name, numv, maxDec);
            return { name, type: 'number', format: cls.format, dec: cls.dec, values: numv };
        }
        if (isDate) {
            if (dayFirst) {
                // re-parse the whole column day-first (rare: UK-style data)
                datev = new Array(rows.length).fill(null);
                for (let r = 0; r < rows.length; r++) {
                    const raw = (rows[r][c] ?? '').trim();
                    if (raw === '') continue;
                    const p = parseDate(raw, true);
                    if (p) datev[r] = p.t;
                }
            }
            return { name, type: 'date', hasTime, values: datev };
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
