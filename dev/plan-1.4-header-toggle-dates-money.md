# plan-1.4-header-toggle-dates-money — header toggle, liberal dates, money 2dp, blank-top files

From discussion 2026-06-11. v1.3 committed; these execute as **1.4.0**.

## 1. "Row 1 is header" toggle

Toolbar toggle showing the mode in effect (auto-detected on load). Clicking
re-interprets the loaded data with the opposite assumption: first row
becomes headers, or becomes data with guessed names. Raw text is kept in
state so the toggle is a clean re-load; filters reset (acceptable).

## 2. Liberal date recognition (n1)

Recognizing a date is what matters ("just a matter of calling it a date");
display stays ISO. New forms accepted:

- numeric triples with `/`, `-`, or `.` separators, 2- or 4-digit years
  (2-digit pivot: <50 → 20xx else 19xx), year-first or year-last;
- month names: `5 Jan 2024`, `05-Jan-24`, `Jan 5, 2024`, `January 5 2024`.

**US/UK ambiguity** (`05/01/2024`) is resolved per column, not per value:
if any value in the column forces day-first (first part > 12), the whole
column parses day-first; otherwise month-first (US default). Date parsing
moves to a second pass over the column so the convention is uniform.

## 3. Money rule (n2) — trumps the clever float rule

- **Header says money** (`amount|amt|balance|price|cost|fee|charge|paid|
  payment|debit|credit|total|premium|loss|salary|wage|income|expense|
  revenue|$£€|usd|gbp|eur|cad`): definitely 2dp, even for all-integer
  columns. (Year classification still wins over a money title.)
- **Values say money**: float columns with observed precision ≤ 2dp and
  max |x| < 100,000 get exactly 2dp.
- Only then: engineering format for wide ranges, else the v1.2
  magnitude-based rule. Full current ruleset documented in
  `human-hints.md` (the author's tracker).

## 4. Blank lines at the top of bank downloads (n3)

Strip a UTF-8 BOM and any leading blank/whitespace-only lines before
sniffing and parsing (previously a leading blank line made the file look
single-column). Pure helper `cleanCsvText`, unit-tested.

## Steps

1. `cleanCsvText`; call at the top of `loadText`.
2. `parseDate(s, dayFirst)` rewrite + `dateNeedsDayFirst`; two-pass date
   inference in `inferColumns`.
3. Money rules in `classifyNumber` (title first, then value rule).
4. Header toggle button + raw-text reload path.
5. Smoke tests; bump 1.4.0 (`app.js` + `sw.js`); CHANGELOG; human-hints
   formatting-rules section.

*Stays in `dev/` until the author says it is done.*
