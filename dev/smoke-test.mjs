// Smoke test for the pure-logic parts of src/grid/core.js + src/grid/util.js
// (parser, sniffing, inference, formatting, filtering, layout solver).
// Run: node dev/smoke-test.mjs
import { readFileSync } from 'node:fs';
import { sniffDelimiter, parseCSV, parseNumber, parseDate, inferColumns,
         classifyNumber, engFormat, looksHeaderless, guessHeaders,
         cleanCsvText, dateNeedsDayFirst, isMarkdownTable,
         parseMarkdownTable, splitMdRow, isNullToken, isUnsafeBigInt } from '../src/grid/core.js';
import { formatCell, makeColPredicate, parseQuery, fuzzyScore, termScore,
         solveWidths, sampleIndices, parseFormatSpec, formatWithSpec,
         parseAlignSpec, normalizeRecords, toCSV, toMarkdown } from '../src/grid/util.js';

let failures = 0;
function check(label, got, want) {
    const ok = JSON.stringify(got) === JSON.stringify(want);
    if (!ok) { failures++; console.log(`FAIL ${label}: got ${JSON.stringify(got)}, want ${JSON.stringify(want)}`); }
    else console.log(`ok   ${label}`);
}

// --- delimiter sniffing
check('sniff comma', sniffDelimiter('a,b,c\n1,2,3'), ',');
check('sniff tab', sniffDelimiter('a\tb\tc\n1\t2\t3'), '\t');
check('sniff semicolon', sniffDelimiter('a;b;c\n1;2;3'), ';');
check('sniff pipe', sniffDelimiter('a|b|c\n1|2|3'), '|');
check('sniff quoted commas in tsv', sniffDelimiter('a\tb\n"x,y,z"\t2'), '\t');

// --- RFC 4180 parsing
check('parse simple', parseCSV('a,b\n1,2', ','), [['a','b'],['1','2']]);
check('parse quoted comma', parseCSV('a,b\n"x,y",2', ','), [['a','b'],['x,y','2']]);
check('parse doubled quote', parseCSV('a\n"he said ""hi"""', ','), [['a'],['he said "hi"']]);
check('parse embedded newline', parseCSV('a,b\n"line1\nline2",2', ','), [['a','b'],['line1\nline2','2']]);
check('parse crlf', parseCSV('a,b\r\n1,2\r\n', ','), [['a','b'],['1','2']]);
check('parse trailing blank lines', parseCSV('a,b\n1,2\n\n\n', ','), [['a','b'],['1','2']]);

// --- numbers
check('num plain', parseNumber('1234'), { v: 1234, dec: 0 });
check('num commas+dec', parseNumber('1,234.56'), { v: 1234.56, dec: 2 });
check('num negative paren', parseNumber('(2,500)'), { v: -2500, dec: 0 });
check('num percent', parseNumber('12.5%'), { v: 0.125, dec: 3 });
check('num dollar', parseNumber('$99.50'), { v: 99.5, dec: 2 });
check('num reject text', parseNumber('12 Main St'), null);
check('num reject date', parseNumber('2024-01-02'), null);
check('num sci small', parseNumber('1e-03'), { v: 0.001, dec: 3 });
check('num sci mantissa dec', parseNumber('1.5e-3'), { v: 0.0015, dec: 4 });
check('num sci big', parseNumber('2.5E+05'), { v: 250000, dec: 0 });
check('num bare dot', parseNumber('.5'), { v: 0.5, dec: 1 });
check('num reject lone e', parseNumber('1e'), null);
// the 1.4.1 bug: a 1e-03 column must be a number column, right-aligned
const scicols = inferColumns(['k'], [['1e-03'], ['2.5e-03'], ['1e-02']]);
check('sci column is number', scicols[0].type, 'number');
check('sci column renders', formatCell('2.5e-03', scicols[0], 1), '0.0025');

// --- dates
check('date iso', parseDate('2024-02-18'), { t: new Date(2024,1,18).getTime(), hasTime: false });
check('date us', parseDate('2/18/2024'), { t: new Date(2024,1,18).getTime(), hasTime: false });
check('date iso datetime', parseDate('2024-02-18 13:45'), { t: new Date(2024,1,18,13,45).getTime(), hasTime: true });
check('date reject bad day', parseDate('2024-02-31'), null);
check('date reject text', parseDate('March'), null);

// --- inference + formatting on a realistic table
const headers = ['name', 'qty', 'price', 'when', 'note'];
const rows = [
    ['alpha', '1,200', '12.5',  '2024-01-05', 'plain'],
    ['beta',  '7',     '0.125', '1/6/2024',   ''],
    ['gamma', '',      '(3)',   '2024-12-31', 'x'.repeat(60)],
];
const cols = inferColumns(headers, rows);
check('infer types', cols.map(c => c.type), ['text','number','number','date','text']);
check('infer qty dec', cols[1].dec, 0);
check('infer price dec (money title)', cols[2].dec, 2);
check('format thousands', formatCell(rows[0][1], cols[1], 0), '1,200');
check('format fixed dec', formatCell(rows[0][2], cols[2], 0), '12.50');
check('format paren neg', formatCell(rows[2][2], cols[2], 2), '-3.00');
check('format us date to iso', formatCell(rows[1][3], cols[3], 1), '2024-01-06');
check('format blank', formatCell(rows[2][1], cols[1], 2), '');

// --- column filter predicates
const qty = cols[1];
check('filter > number', [0,1,2].map(r => { const p = makeColPredicate('>100', qty); return p(rows[r][1], r); }), [true, false, false]);
check('filter range', [0,1,2].map(r => { const p = makeColPredicate('1..10', qty); return p(rows[r][1], r); }), [false, true, false]);
const when = cols[3];
check('filter date >=', [0,1,2].map(r => { const p = makeColPredicate('>=2024-06-01', when); return p(rows[r][3], r); }), [false, false, true]);
const name = cols[0];
check('filter substring', [0,1,2].map(r => { const p = makeColPredicate('ALph', name); return p(rows[r][0], r); }), [true, false, false]);

// --- fzf query parsing
check('query kinds', parseQuery("abc 'def !ghi ^jk lm$").map(t => t.kind),
      ['fuzzy', 'exact', 'exact', 'prefix', 'suffix']);
check('query negate', parseQuery('!ghi')[0].negate, true);
check('query smart case', parseQuery('abc Abc').map(t => t.cs), [false, true]);

// --- fuzzy scoring
check('fuzzy no match', fuzzyScore('xyz', 'middlemarch'), -1);
check('fuzzy subsequence matches', fuzzyScore('mlch', 'middlemarch') >= 0, true);
check('fuzzy consecutive beats scattered',
      fuzzyScore('march', 'middlemarch') > fuzzyScore('mac', 'middlemarch'), true);
check('fuzzy boundary beats mid-word',
      fuzzyScore('big', 'the big short') > fuzzyScore('big', 'ambiguous'), true);

// --- term evaluation (match/score against row text)
const lowRow = 'war and peace tolstoy, leo', rawRow = 'War and Peace Tolstoy, Leo';
check('term exact', termScore(parseQuery("'peace")[0], lowRow, rawRow) >= 0, true);
check('term negate excludes', termScore(parseQuery('!peace')[0], lowRow, rawRow), -1);
check('term case-sensitive', termScore(parseQuery('PEACE')[0], lowRow, rawRow), -1);
check('term prefix', termScore(parseQuery('^war')[0], lowRow, rawRow) >= 0, true);

// --- equal-risk width solver (arrays sorted ascending)
const constant = Array(99).fill(100);            // sd = 0
const spread = Array.from({ length: 99 }, (_, i) => 10 + 10 * i);  // 10..990
check('widths fit -> natural (tight)',
      solveWidths([constant, spread], [50, 50], 5000), [100, 990]);
const squeezed = solveWidths([constant, spread], [50, 50], 600);
check('squeeze respects budget', squeezed[0] + squeezed[1] <= 600, true);
check('squeeze: low-sd col shown fully', squeezed[0], 100);
check('squeeze: high-sd col absorbs it', squeezed[1] < 990, true);
check('floors when nothing fits', solveWidths([constant, spread], [60, 70], 100), [100, 70]);

// --- coverage width mode (3.1): greedy water-fill, thin vs thick tail.
// Col A (thin) needs 60..90; Col B (thick) hides one outlier at 400.
const thin = [60, 70, 80, 90], thick = [60, 70, 80, 400], wfloors = [50, 50];
const er = solveWidths([thin, thick], wfloors, 300, 'equal-risk');
const cov = solveWidths([thin, thick], wfloors, 300, 'coverage');
const shown = ws => [thin, thick].reduce((acc, s, j) => acc + s.filter(x => x <= ws[j]).length, 0);
check('coverage respects budget', cov[0] + cov[1] <= 300, true);
check('coverage shows more full cells than equal-risk', shown(cov) > shown(er), true);
check('coverage completes the thin column', cov[0], 90);
check('width mode defaults to equal-risk',
      solveWidths([thin, thick], wfloors, 300), er);
// shared regimes: coverage agrees with equal-risk when all fits / nothing fits
check('coverage tight -> natural',
      solveWidths([constant, spread], [50, 50], 5000, 'coverage'), [100, 990]);
check('coverage nothing-fits -> floors',
      solveWidths([thin, thick], [60, 70], 100, 'coverage'), [60, 70]);

// --- number format classification (greater_tables rules)
check('year by range', classifyNumber('started', [1990, 2005, 2024], 0).format, 'year');
check('year by title', classifyNumber('Accident Year', [1492, 2120], 0).format, 'year');
check('year bounds inclusive', classifyNumber('proj', [1800, 2030, 2100], 0).format, 'year');
check('not year out of range', classifyNumber('count', [1990, 2101], 0).format, 'int');
check('not year below range', classifyNumber('count', [1799, 1990], 0).format, 'int');
check('int gets commas format', classifyNumber('pages', [880, 1225], 0), { format: 'int', dec: 0 });
check('eng for wide range', classifyNumber('x', [0.0000012, 4500000], 7).format, 'eng');
// money rules trump the magnitude rule
check('money title float 2dp', classifyNumber('loss', [12500.25, 9800.5], 2).dec, 2);
check('money title int 2dp', classifyNumber('Amount 1', [1200, 7], 0),
      { format: 'float', dec: 2 });
check('money by value 2dp', classifyNumber('x', [12500.25, 9800.5], 2).dec, 2);
check('not money over 100k -> magnitude rule',
      classifyNumber('factor', [250000.5, 980000.25], 2).dec, 0);
check('not money 3dp -> magnitude rule', classifyNumber('coeff', [0.015, 0.025], 3).dec, 3);
check('year beats money title', classifyNumber('premium year', [1990, 2024], 0).format, 'year');
check('float unit-scale dec 2', classifyNumber('q', [12.5, 9.25], 2).dec, 2);

// year column renders plain
const ycols = inferColumns(['year', 'n'], [['1995', '1,200'], ['2020', '7']]);
check('year renders no comma', formatCell('1995', ycols[0], 0), '1995');
check('int renders comma', formatCell('1,200', ycols[1], 0), '1,200');

// --- engineering format
check('eng kilo', engFormat(12345), '12.3k');
check('eng mega', engFormat(4500000), '4.5M');
check('eng milli', engFormat(0.00123), '1.23m');
check('eng negative', engFormat(-12345), '-12.3k');
check('eng zero', engFormat(0), '0');
check('eng unit range', engFormat(123.4), '123');

// --- headerless detection + guessed names (bank-export style)
check('headerless: bank row', looksHeaderless(['2024-01-05', 'STARBUCKS #123', '-4.50']), true);
check('headerless: header row', looksHeaderless(['Date', 'Description', 'Amount']), false);
check('headerless: all-text stays headed', looksHeaderless(['alpha', 'beta']), false);
const bank = [
    ['2024-01-05', 'STARBUCKS', 'POS', '-4.50', '1,200.00'],
    ['2024-01-06', 'PAYROLL',   'ACH', '2,500.00', '3,695.50'],
];
const bcols = inferColumns(['col1', 'col2', 'col3', 'col4', 'col5'], bank);
guessHeaders(bcols);
check('guessed names', bcols.map(c => c.name),
      ['Date', 'Description 1', 'Description 2', 'Amount 1', 'Amount 2']);
const ycols2 = inferColumns(['col1', 'col2'], [['1995', 'x'], ['2020', 'y']]);
guessHeaders(ycols2);
check('guessed year name', ycols2.map(c => c.name), ['Year', 'Description']);

// --- liberal dates (1.4)
const D = (y, m, d) => ({ t: new Date(y, m - 1, d).getTime(), hasTime: false });
check('date us default', parseDate('05/01/2024'), D(2024, 5, 1));
check('date day-first flag', parseDate('05/01/2024', true), D(2024, 1, 5));
check('date forced day-first', parseDate('13/05/2024'), D(2024, 5, 13));
check('date forced month-first', parseDate('05/13/2024', true), D(2024, 5, 13));
check('date dashes', parseDate('13-05-2024'), D(2024, 5, 13));
check('date dots', parseDate('13.05.2024'), D(2024, 5, 13));
check('date y/m/d slashes', parseDate('2024/05/01'), D(2024, 5, 1));
check('date 2-digit year 99', parseDate('5/1/99'), D(1999, 5, 1));
check('date 2-digit year 24', parseDate('5/1/24'), D(2024, 5, 1));
check('date d Mon y', parseDate('5 Jan 2024'), D(2024, 1, 5));
check('date dd-Mon-yy', parseDate('05-Jan-24'), D(2024, 1, 5));
check('date Mon d, y', parseDate('Jan 5, 2024'), D(2024, 1, 5));
check('date full month', parseDate('January 5 2024'), D(2024, 1, 5));
check('date reject bad month word', parseDate('Jam 5, 2024'), null);
check('needs day-first', dateNeedsDayFirst('13/05/2024'), true);
check('no day-first signal', dateNeedsDayFirst('05/01/2024'), false);
// column-level convention: one forcing value flips the whole column
const ukcols = inferColumns(['when'], [['05/01/2024'], ['13/01/2024']]);
check('uk column day-first', formatCell('05/01/2024', ukcols[0], 0), '2024-01-05');
const uscols = inferColumns(['when'], [['05/01/2024'], ['12/01/2024']]);
check('us column month-first', formatCell('05/01/2024', uscols[0], 0), '2024-05-01');

// --- 3.2 Stage A: inference quality ------------------------------------

// A1 — null tokens don't demote a numeric column; they render blank
check('isNullToken cases', [isNullToken('NaN'), isNullToken(' na '), isNullToken('#N/A'),
       isNullToken('-'), isNullToken('hello'), isNullToken('')], [true, true, true, true, false, false]);
const nullcol = inferColumns(['v'], [['100'], ['NaN'], ['N/A'], ['200'], ['-']]);
check('A1 null tokens keep number type', nullcol[0].type, 'number');
check('A1 NaN renders blank', formatCell('NaN', nullcol[0], 1), '');
check('A1 N/A renders blank', formatCell('N/A', nullcol[0], 2), '');
check('A1 dash renders blank', formatCell('-', nullcol[0], 4), '');
check('A1 real number still formats', formatCell('100', nullcol[0], 0), '100');
// text columns keep their literal tokens (None may be a real category)
check('A1 text column keeps token',
      formatCell('None', inferColumns(['s'], [['alpha'], ['None'], ['beta']])[0], 1), 'None');

// A2 — type decided from a stride sample: an oddball outside the sample
// (index 1 is not in sampleIndices(5000, 2048)) can't demote the column
const bigNum = Array.from({ length: 5000 }, () => ['5']);
bigNum[1] = ['oops'];
const bigCols = inferColumns(['v'], bigNum);
check('A2 out-of-sample oddball does not demote', bigCols[0].type, 'number');
check('A2 oddball renders raw (never hidden)', formatCell('oops', bigCols[0], 1), 'oops');
check('A2 sampled cell still formats', formatCell('5', bigCols[0], 0), '5');
// small files: sample = all rows, so a stray text cell still demotes
check('A2 small file stays strict',
      inferColumns(['v'], [['5'], ['oops'], ['7']])[0].type, 'text');

// A3 — identifier-named integer columns drop thousands separators
check('A3 account number -> plain', classifyNumber('Account Number', [1200, 9000], 0),
      { format: 'plain', dec: 0 });
check('A3 policy id -> plain', classifyNumber('Policy ID', [100123, 100124], 0).format, 'plain');
check('A3 plain renders without commas',
      formatCell('100200', inferColumns(['Account No'], [['100200'], ['100300']])[0], 0), '100200');
check('A3 year still beats identifier', classifyNumber('Order Year', [2019, 2024], 0).format, 'year');
check('A3 money word beats identifier (Order Amount)',
      classifyNumber('Order Amount', [1200, 9000], 0), { format: 'float', dec: 2 });
check('A3 money word beats identifier (Account Balance)',
      classifyNumber('Account Balance', [1200, 9000], 0).dec, 2);

// A4 — significant leading zeros stay text; plain 0 / 0.5 do not
check('A4 leading-zero code -> text',
      inferColumns(['code'], [['007'], ['012'], ['100']])[0].type, 'text');
check('A4 plain zero stays number',
      inferColumns(['v'], [['0'], ['5'], ['10']])[0].type, 'number');
check('A4 decimal below one stays number',
      inferColumns(['v'], [['0.5'], ['1.5']])[0].type, 'number');

// A5 — ambiguous all-numeric date columns flag ambiguousOrder
check('A5 ambiguous flagged',
      inferColumns(['d'], [['05/01/2024'], ['06/02/2024']])[0].ambiguousOrder, true);
check('A5 forced day-first not ambiguous',
      inferColumns(['d'], [['05/01/2024'], ['13/02/2024']])[0].ambiguousOrder, false);
check('A5 forced month-first not ambiguous',
      inferColumns(['d'], [['05/01/2024'], ['12/31/2024']])[0].ambiguousOrder, false);
check('A5 ISO not ambiguous',
      inferColumns(['d'], [['2024-01-05'], ['2024-02-06']])[0].ambiguousOrder, false);
check('A5 month-name not ambiguous',
      inferColumns(['d'], [['Jan 5, 2024'], ['Feb 6, 2024']])[0].ambiguousOrder, false);

// --- 3.3 Stage D1: integers beyond 2^53 kept as exact text --------------
check('D1 isUnsafeBigInt cases',
      [isUnsafeBigInt('9007199254740991'),   // 2^53-1, exactly max -> safe
       isUnsafeBigInt('9007199254740993'),   // 2^53+1 -> unsafe
       isUnsafeBigInt('9999999999999999'),   // 16 nines -> unsafe
       isUnsafeBigInt('123456789012345678901234567890'), // 30 digits -> unsafe
       isUnsafeBigInt('42'),                 // small -> safe
       isUnsafeBigInt('1.23e30'),            // float form -> not integer-form
       isUnsafeBigInt('12.5'),               // has decimal -> safe
       isUnsafeBigInt('-9999999999999999'),  // signed unsafe
       isUnsafeBigInt('(9999999999999999)'), // paren-negative unsafe
       isUnsafeBigInt('50%')],               // percent -> not a big int
      [false, true, true, true, false, false, false, true, true, false]);
const bigcol = inferColumns(['value'],
    [['9007199254740993'], ['9999999999999999'], ['123456789012345678901234567890'], ['42']]);
check('D1 big-int column forced to text', bigcol[0].type, 'text');
check('D1 big-int column right-aligned', bigcol[0].align, 'right');
check('D1 big-int digits render verbatim',
      formatCell('123456789012345678901234567890', bigcol[0], 2), '123456789012345678901234567890');
check('D1 safe integer column stays number',
      inferColumns(['v'], [['9007199254740991'], ['42']])[0].type, 'number');
check('D1 float with big exponent stays number',
      inferColumns(['v'], [['1.23e30'], ['4.5e29']])[0].type, 'number');
// long account/ID numbers above 2^53 also become exact text (right-aligned)
check('D1 long account number -> exact text',
      inferColumns(['Account No'], [['12345678901234567'], ['12345678901234568']])[0].type, 'text');

// --- 3.3 Stage D2: percent format for ratio columns ---------------------
check('D2 ratio in-range -> percent', classifyNumber('loss_ratio', [0.625, 0.481], 3),
      { format: 'pct', dec: 1 });
check('D2 snake_case ratio matched (letter boundary, not \\b)',
      classifyNumber('combined_ratio', [1.04, 0.98], 2).format, 'pct');
check('D2 percent beats money word ("loss ratio")',
      classifyNumber('loss ratio', [0.6, 0.7], 2).format, 'pct');
check('D2 short token roe', classifyNumber('roe', [0.12, 0.18], 2).format, 'pct');
check('D2 short token does not bleed (prorate != rate)',
      classifyNumber('prorated', [0.5, 1.2], 1).format, 'float');
check('D2 out-of-range float ratio stays non-percent (no x100)',
      classifyNumber('rate', [62.5, 71.2], 1).format, 'float');
check('D2 all-integer ratio skipped (units ambiguous)',
      classifyNumber('rate', [1, 2], 0).format, 'int');
check('D2 percent decimals uniform from data (4dp -> 2)',
      classifyNumber('yield', [0.1523, 0.2], 4).dec, 2);
check('D2 percent decimals floor at 1 (2dp -> 1)',
      classifyNumber('margin', [1.04, 0.98], 2).dec, 1);
check('D2 non-ratio float unchanged', classifyNumber('temperature', [0.5, 1.2], 1).format, 'float');
const pctcol = inferColumns(['lr'], [['0.625'], ['0.481']]);
check('D2 percent renders with %', formatCell('0.625', pctcol[0], 0), '62.5%');
check('D2 percent right-aligned like numbers', pctcol[0].type, 'number');
// a %-suffixed source column round-trips: 12.5% -> 0.125 -> 12.5%
check('D2 percent source round-trips',
      formatCell('12.5%', inferColumns(['pct'], [['12.5%'], ['8.0%']])[0], 0), '12.5%');

// --- 3.3 Stage D3: raw display mode (formatCell 'raw' lens) -------------
// raw returns the verbatim trimmed source; type/align/sort are unaffected
const d3cols = inferColumns(['n', 'when', 'lr'],
    [['1,200', '1/6/2024', '0.625'], ['7', '2/30/2020', '0.481']]);
check('D3 raw shows source number (no separators)',
      formatCell('1,200', d3cols[0], 0, 'raw'), '1,200');
check('D3 auto still formats number', formatCell('1,200', d3cols[0], 0, 'auto'), '1,200');
check('D3 raw shows source date (no ISO normalize)',
      formatCell('1/6/2024', d3cols[1], 0, 'raw'), '1/6/2024');
check('D3 raw shows source percent fraction',
      formatCell('0.625', d3cols[2], 0, 'raw'), '0.625');
check('D3 raw blank stays blank', formatCell('  ', d3cols[0], 0, 'raw'), '');
check('D3 raw on big-int text is verbatim',
      formatCell('123456789012345678901234567890',
                 inferColumns(['v'], [['123456789012345678901234567890'], ['42']])[0], 0, 'raw'),
      '123456789012345678901234567890');

// --- 3.2 Stage B: export serializers ------------------------------------

check('toCSV basic', toCSV(['a', 'b'], [['1', '2'], ['3', '4']]), 'a,b\r\n1,2\r\n3,4');
check('toCSV quotes comma/quote/newline',
      toCSV(['x'], [['a,b'], ['he said "hi"'], ['line1\nline2']]),
      'x\r\n"a,b"\r\n"he said ""hi"""\r\n"line1\nline2"');
check('toCSV no quote when clean', toCSV(['x'], [['plain']]), 'x\r\nplain');
check('toCSV null/undefined -> empty', toCSV(['a', 'b'], [[null, undefined]]), 'a,b\r\n,');
check('toMarkdown alignment row (compact, no inner spaces)',
      toMarkdown(['Book', 'Year', 'Price'], [['War & Peace', '1869', '24.99']],
                 ['left', 'center', 'right']),
      '| Book | Year | Price |\n|:---|:--:|---:|\n| War & Peace | 1869 | 24.99 |');
check('toMarkdown escapes pipe, collapses newline',
      toMarkdown(['x'], [['a|b'], ['line1\nline2']]),
      '| x |\n|---|\n| a\\|b |\n| line1 line2 |');
check('toMarkdown default separator when no aligns',
      toMarkdown(['a', 'b'], [['1', '2']]),
      '| a | b |\n|---|---|\n| 1 | 2 |');

// --- cleanCsvText (1.4): BOM + leading blank lines
check('clean bom', cleanCsvText('﻿a,b\n1,2'), 'a,b\n1,2');
check('clean leading blanks', cleanCsvText('\r\n  \r\na,b\r\n1,2'), 'a,b\r\n1,2');
check('clean leaves good text alone', cleanCsvText('a,b\n1,2'), 'a,b\n1,2');

// --- expand-all = solver with infinite budget returns natural widths
check('expand: infinite budget -> natural',
      solveWidths([constant, spread], [50, 50], Infinity), [100, 990]);

// --- markdown pipe tables (1.5)
const md = `| Book | Year | Price |
|:-----|:----:|------:|
| War and Peace | 1869 | 24.99 |
| Middlemarch | 1871 | 18.50 |`;
check('md detected', isMarkdownTable(md), true);
check('csv not md', isMarkdownTable('a,b\n1,2'), false);
check('pipe csv not md', isMarkdownTable('a|b\n1|2'), false);
const mdt = parseMarkdownTable(md);
check('md headers', mdt.headers, ['Book', 'Year', 'Price']);
check('md aligns', mdt.aligns, ['left', 'center', 'right']);
check('md rows', mdt.rows[0], ['War and Peace', '1869', '24.99']);
check('md no outer pipes', parseMarkdownTable('a | b\n--- | ---\n1 | 2').rows, [['1', '2']]);
check('md escaped pipe', splitMdRow('| a \\| b | c |'), ['a | b', 'c']);
check('md bare dashes -> no align override',
      parseMarkdownTable('a|b\n---|---\n1|2').aligns, [null, null]);

// --- stride sampling for width percentiles (2.0)
check('sample small n = all', sampleIndices(5, 2000), [0, 1, 2, 3, 4]);
const samp = sampleIndices(250000, 2000);
check('sample size', samp.length, 2000);
check('sample starts at 0', samp[0], 0);
check('sample in range', samp[samp.length - 1] < 250000, true);
check('sample strictly increasing', samp.every((v, i) => i === 0 || v > samp[i - 1]), true);

// --- format spec parser + formatter (3.0 stage 2)
check('spec ,.0f', formatWithSpec(1234.56, parseFormatSpec(',.0f')), '1,235');
check('spec .1%', formatWithSpec(0.125, parseFormatSpec('.1%')), '12.5%');
check('spec % default 0dp', formatWithSpec(0.125, parseFormatSpec('%')), '13%');
check('spec ,d rounds + groups', formatWithSpec(1234.4, parseFormatSpec(',d')), '1,234');
check('spec d plain', formatWithSpec(1234.4, parseFormatSpec('d')), '1234');
check('spec f default 2dp', formatWithSpec(3.14159, parseFormatSpec('f')), '3.14');
check('spec ,.3f', formatWithSpec(12345.6789, parseFormatSpec(',.3f')), '12,345.679');
check('spec .2e', formatWithSpec(12345, parseFormatSpec('.2e')), '1.23e+4');
check('spec year', formatWithSpec(1995, parseFormatSpec('year')), '1995');
check('spec eng', formatWithSpec(4500000, parseFormatSpec('eng')), '4.5M');
check('spec s default = eng', formatWithSpec(4500000, parseFormatSpec('s')), '4.5M');
check('spec .1s fixed dec', formatWithSpec(12345, parseFormatSpec('.1s')), '12.3k');
check('spec .1s negative', formatWithSpec(-12345, parseFormatSpec('.1s')), '-12.3k');
check('spec .0s milli', formatWithSpec(0.0021, parseFormatSpec('.0s')), '2m');
check('spec null = auto', parseFormatSpec(null), null);
check('spec empty = auto', parseFormatSpec(''), null);
check('spec invalid throws',
      (() => { try { parseFormatSpec('zz'); return false; } catch { return true; } })(), true);
// fmt on a column overrides the auto rules; null entries keep them
const fcols = inferColumns(['rate', 'n'], [['0.125', '1,200'], ['0.5', '7']]);
fcols[0].fmt = parseFormatSpec('.1%');
fcols[1].fmt = parseFormatSpec(null);
check('fmt overrides auto', formatCell('0.125', fcols[0], 0), '12.5%');
check('fmt null keeps auto', formatCell('1,200', fcols[1], 0), '1,200');

// --- align spec (3.0 stage 2)
check('align spec lrc', parseAlignSpec('lrc'), ['left', 'right', 'center']);
check('align spec other chars = default', parseAlignSpec('l-r'), ['left', null, 'right']);

// --- records normalization (3.0 stage 2)
const nr = normalizeRecords([{ a: 1200, b: 'x' }, { a: NaN, b: null }]);
check('records headers from keys', nr.headers, ['a', 'b']);
check('records nan/null blank', nr.rows[1], ['', '']);
check('records re-infer types', nr.cols.map(c => c.type), ['number', 'text']);
check('records format', formatCell(nr.rows[0][0], nr.cols[0], 0), '1,200');
const nr2 = normalizeRecords([[1, 'x'], [2, 'y']], ['a', 'b']);
check('records array-of-arrays', nr2.rows, [['1', 'x'], ['2', 'y']]);
check('records columns subset', normalizeRecords([{ a: 1, b: 2 }], ['b']).rows, [['2']]);
check('records arrays need columns',
      (() => { try { normalizeRecords([[1]]); return false; } catch { return true; } })(), true);

// --- python emitter round-trip (3.0 stage 5): pandas -> JSON payload
// (dev/python-payload.json, regenerated by dev/make-embed-test-python.py)
// -> the grid's records normalization -> inference + auto formatting
const py = JSON.parse(readFileSync(new URL('./python-payload.json', import.meta.url), 'utf8'));
const pyd = normalizeRecords(py.records, py.columns);
check('py columns', pyd.headers, ['line', 'premium', 'loss_ratio', 'year', 'written', 'rate']);
check('py types re-inferred', pyd.cols.map(c => c.type),
      ['text', 'number', 'number', 'number', 'date', 'number']);
check('py NaN/None -> blank', [pyd.rows[3][1], pyd.rows[4][2]], ['', '']);
check('py integral floats -> int (money title 2dp)',
      formatCell(pyd.rows[0][1], pyd.cols[1], 0), '12,500,000.00');
check('py year column plain', formatCell(pyd.rows[0][3], pyd.cols[3], 0), '1995');
check('py date iso', formatCell(pyd.rows[0][4], pyd.cols[4], 0), '1995-03-15');
// loss_ratio + rate columns are now percents (D2): fractions <= 2, ratio names
check('py loss_ratio is percent', pyd.cols[2].format, 'pct');
check('py rate percent', formatCell(pyd.rows[3][5], pyd.cols[5], 3), '100.0%');

// --- dist ES bundle loads as a real module with CsvGrid as its default
// export (3.0 stage 4; loadability only — instantiation needs a DOM;
// rebuild with `npm run build` after source changes)
const dist = await import(new URL('../dist/csv-grid.es.js', import.meta.url))
    .catch(e => ({ error: e.message }));
check('dist es bundle imports', dist.error ?? null, null);
check('dist default export is CsvGrid', typeof dist.default, 'function');
check('dist export is a class', /^class/.test(String(dist.default)), true);

console.log(failures ? `\n${failures} FAILURE(S)` : '\nall checks passed');
process.exit(failures ? 1 : 0);
