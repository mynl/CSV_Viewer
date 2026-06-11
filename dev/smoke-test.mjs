// Smoke test for the pure-logic parts of src/core.js + src/app.js
// (parser, sniffing, inference, formatting, filtering, layout solver).
// Run: node dev/smoke-test.mjs
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const core = readFileSync(new URL('../src/core.js', import.meta.url), 'utf8');
const app = readFileSync(new URL('../src/app.js', import.meta.url), 'utf8');
const ctx = { document: { addEventListener() {}, getElementById: () => null }, Intl, console };
vm.createContext(ctx);
vm.runInContext(core, ctx);
vm.runInContext(app, ctx);
const { sniffDelimiter, parseCSV, parseNumber, parseDate, inferColumns,
        formatCell, makeColPredicate, parseQuery, fuzzyScore, termScore,
        solveWidths, classifyNumber, engFormat, looksHeaderless,
        guessHeaders, cleanCsvText, dateNeedsDayFirst, isMarkdownTable,
        parseMarkdownTable, splitMdRow, sampleIndices } = ctx;

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
check('not money 3dp -> magnitude rule', classifyNumber('rate', [0.015, 0.025], 3).dec, 3);
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

console.log(failures ? `\n${failures} FAILURE(S)` : '\nall checks passed');
process.exit(failures ? 1 : 0);
