// Smoke test for the pure-logic half of app.js (parser, sniffing, type
// inference, formatting, filtering). Run: node dev/smoke-test.mjs
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const src = readFileSync(new URL('../app.js', import.meta.url), 'utf8');
const ctx = { document: { addEventListener() {}, getElementById: () => null }, Intl, console };
vm.createContext(ctx);
vm.runInContext(src, ctx);
const { sniffDelimiter, parseCSV, parseNumber, parseDate, inferColumns,
        formatCell, makeColPredicate } = ctx;

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
check('infer price dec', cols[2].dec, 3);
check('format thousands', formatCell(rows[0][1], cols[1], 0), '1,200');
check('format fixed dec', formatCell(rows[0][2], cols[2], 0), '12.500');
check('format paren neg', formatCell(rows[2][2], cols[2], 2), '-3.000');
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

console.log(failures ? `\n${failures} FAILURE(S)` : '\nall checks passed');
process.exit(failures ? 1 : 0);
