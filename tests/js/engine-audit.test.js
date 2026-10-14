// Run: node tests/js/engine-audit.test.js
//
// KNOWN-BUG suite. Every test here FAILS on the current kit/core and is expected to PASS once the matching patch in
// research/engine-audit.md is applied (IDs E* = rk.expr.js, F* = rk.format.js, Q* = rk.data.js). It is deliberately kept
// out of tests/js/core.test.js and tests/js/engine.test.js so the main suite stays green.
//
//   node tests/js/engine-audit.test.js                    # today: every test fails, exit code 1
//   RK_CORE_DIR=/tmp/patched/kit/core node tests/js/engine-audit.test.js   # after the patches: all pass, exit code 0
//   node tests/js/engine-audit.test.js --list             # one line per test with pass/fail
//
// When a patch lands, move its tests into engine.test.js.
'use strict';
const assert = require('assert');
const { loadSamples, runner, throwsExpr, within } = require('./_harness');

const J = (v) => JSON.stringify(v);
const eqJ = (a, b, msg) => assert.strictEqual(J(a), J(b), msg);

(async function main() {
  const RK = await loadSamples();
  const E = RK.expr, F = RK.format, Q = RK.query;
  const { t, done } = runner('engine-audit.test.js (expected to fail until research/engine-audit.md patches are applied)');
  const ev = (src, row, env) => E.evaluate(src, row || {}, env ? { env } : undefined);
  const rows = [{ s: 'A', v: 1, w: 1 }, { s: 'A', v: 3, w: 3 }, { s: 'B', v: 10, w: 1 }];

  /* ======================= rk.expr.js ======================= */

  // E1 — text that is not a number compared with a number behaved like 0
  t('E1 "n.a." < 6 is false (was true: text treated as 0)', () => assert.strictEqual(ev('x < 6', { x: 'n.a.' }), false));
  t('E1 "NM" >= 0 is false', () => assert.strictEqual(ev('x >= 0', { x: 'NM' }), false));
  t('E1 where x < 6 skips text placeholders', () => {
    RK.data.put({ id: 'mixed', data: [{ x: 5 }, { x: 'n.a.' }, { x: null }, { x: '7' }] });
    eqJ(Q('x from mixed where x < 6').rows, [{ x: 5 }]);
  });
  t('E1 ISO date vs number is not comparable (was: every date < 2021)', () => assert.strictEqual(Q('count() from precedents where date < 2021').rows[0].c1, 0));
  t('E1 "a" >= "A" agrees with "a" == "A" (case-insensitive ordering)', () => { assert.strictEqual(ev('"a" == "A"'), true); assert.strictEqual(ev('"a" >= "A"'), true); assert.strictEqual(ev('"a" <= "A"'), true); });

  // E2 — aggregate argument counts were not checked: TypeError at evaluation, check() said ok
  t('E2 wavg(v) -> ExprError at compile time', () => throwsExpr(RK, () => E.compile('wavg(v)'), /wavg\(\) expects 2 arguments, got 1/));
  t('E2 wavg() -> ExprError', () => throwsExpr(RK, () => E.compile('wavg()'), /wavg\(\) expects 2 arguments, got 0/));
  t('E2 sum() -> ExprError', () => throwsExpr(RK, () => E.compile('sum()'), /sum\(\) expects 1 argument, got 0/));
  t('E2 sum(v, w) -> ExprError (second argument was silently ignored)', () => throwsExpr(RK, () => E.compile('sum(v, w)'), /sum\(\) expects 1 argument, got 2/));
  t('E2 pctl() -> ExprError', () => throwsExpr(RK, () => E.compile('pctl()'), /pctl\(\) expects 1-2 arguments, got 0/));
  t('E2 pctl(v, w) with a field as percentile -> ExprError (was: min, evaluated on a null row)', () => throwsExpr(RK, () => E.compile('pctl(v, w)'), /percentile must be a number or @param/));
  t('E2 check("wavg(v)") reports the problem', () => { const c = E.check('wavg(v)'); assert.strictEqual(c.ok, false); assert.ok(/expects 2 arguments/.test(c.error), c.error); });
  t('E2 count(a, b) -> ExprError', () => throwsExpr(RK, () => E.compile('count(a, b)'), /count\(\) expects 0-1 arguments/));

  // E3 — nested aggregates: message told the user to use a grouped query (they were in one)
  t('E3 sum(sum(v)) says aggregates cannot be nested', () => throwsExpr(RK, () => E.compile('sum(sum(v))'), /Aggregates cannot be nested: sum\(\) contains another aggregate/));
  t('E3 median(max(v)) message names the outer aggregate', () => throwsExpr(RK, () => E.compile('median(max(v))'), /median\(\) contains another aggregate/));

  // E4 — round() used Math.round(x * 10^d): binary error and half-up toward +infinity
  t('E4 round(1.005, 2) = 1.01 (Excel)', () => assert.strictEqual(ev('round(1.005, 2)'), 1.01));
  t('E4 round(1.255, 2) = 1.26', () => assert.strictEqual(ev('round(1.255, 2)'), 1.26));
  t('E4 round(0.285, 2) = 0.29', () => assert.strictEqual(ev('round(0.285, 2)'), 0.29));
  t('E4 round(-2.5) = -3 (half away from zero)', () => assert.strictEqual(ev('round(-2.5)'), -3));
  t('E4 round(-1.005, 2) = -1.01', () => assert.strictEqual(ev('round(-1.005, 2)'), -1.01));
  t('E4 round(1e300, 10) = 1e300 (was Infinity)', () => assert.strictEqual(ev('round(1e300, 10)'), 1e300));
  t('E4 round(1.23456, 1.5) truncates digits like Excel = 1.2', () => assert.strictEqual(ev('round(1.23456, 1.5)'), 1.2));
  t('E4 round(-0.001, 2) is 0, not -0', () => assert.ok(Object.is(ev('round(-0.001, 2)'), 0)));

  // E5 — a NaN weight poisoned the whole weighted average
  t('E5 wavg skips NaN weights', () => assert.strictEqual(ev('wavg(v, w)', [{ v: 1, w: 0 / 0 }, { v: 2, w: 1 }]), 2));
  t('E5 wavg with a weight from a division by zero', () => assert.strictEqual(ev('wavg(v, a / b)', [{ v: 1, a: 1, b: 0 }, { v: 4, a: 2, b: 1 }]), 4));

  // E6 — min()/max() used Math.min.apply (stack overflow on large data) and ignored ISO dates
  const big = Array.from({ length: 250000 }, (_, i) => ({ v: i % 1000 }));
  t('E6 min() over 250k rows (was RangeError)', () => assert.strictEqual(ev('min(v)', big), 0));
  t('E6 max() over 250k rows', () => assert.strictEqual(ev('max(v)', big), 999));
  t('E6 RK.expr.agg.min on 250k values (used by components)', () => assert.strictEqual(RK.expr.agg.min(big.map(x => x.v)), 0));
  t('E6 min(date) / max(date) on ISO dates (was null)', () => {
    const dates = RK.data.get('precedents').rows.map(x => x.date).sort();
    eqJ(Q('min(date) as first, max(date) as last from precedents').rows[0], { c1: dates[0], c2: dates[dates.length - 1] });
  });

  // E7 — plain-object lookups exposed Object.prototype (no code execution is possible, but values leak / names break)
  t('E7 a field named "constructor" can be used bare', () => assert.strictEqual(ev('constructor + 1', { constructor: 1 }), 2));
  t('E7 a schema field named "constructor" compiles', () => assert.strictEqual(E.compile('constructor', { fields: [{ name: 'constructor' }] }).eval({ constructor: 'x' }), 'x'));
  t('E7 a field named "__proto__" can be used bare', () => assert.strictEqual(E.compile('__proto__ * 2', { fields: [{ name: '__proto__' }] }).eval(JSON.parse('{"__proto__": 5}')), 10));
  t('E7 `constructor` without a schema is a missing field, not the Object function', () => assert.strictEqual(ev('`constructor`', { a: 1 }), null));
  t('E7 [toString] without a schema is null', () => assert.strictEqual(ev('[toString]', { a: 1 }), null));
  t('E7 @constructor is an unknown parameter', () => throwsExpr(RK, () => ev('@constructor', {}, { params: { wacc: 0.1 } }), /Unknown parameter @constructor/));
  t('E7 @__proto__ is an unknown parameter', () => throwsExpr(RK, () => ev('@__proto__', {}, { params: {} }), /Unknown parameter @__proto__/));
  t('E7 constructor(...) is an unknown function, not if()', () => throwsExpr(RK, () => ev('constructor(true, 1, 2)'), /Unknown function constructor\(\)/));
  t('E7 schema field "constructor" missing in a row reads as null, not a function', () => {
    RK.data.put({ id: 'ctor', schema: { fields: [{ name: 'k', type: 'string' }, { name: 'constructor', type: 'string' }] }, data: [{ k: 'a' }] });
    assert.strictEqual(Q('`constructor` from ctor').rows[0].constructor, null);
  });

  // E8 — a missing bound counted as 0
  t('E8 clamp(5) = 5 (was 0)', () => assert.strictEqual(ev('clamp(5)'), 5));
  t('E8 clamp(-5, null, 3) = -5 (was 0)', () => assert.strictEqual(ev('clamp(-5, null, 3)'), -5));
  t('E8 between(-5, null, 10) is true', () => assert.strictEqual(ev('between(-5, null, 10)'), true));
  t('E8 between(50, 1, null) is true', () => assert.strictEqual(ev('between(50, 1, null)'), true));

  // E9 — String(null) === "null"; endswith(s, "") disagreed with startswith(s, "")
  t('E9 contains("a null b", null) is false', () => assert.strictEqual(ev('contains("a null b", null)'), false));
  t('E9 startswith("null", null) is false', () => assert.strictEqual(ev('startswith("null", null)'), false));
  t('E9 endswith("abc", "") is true like startswith("abc", "")', () => { assert.strictEqual(ev('startswith("abc", "")'), true); assert.strictEqual(ev('endswith("abc", "")'), true); });

  // E10 — stack overflow surfaced as RangeError (or Firefox InternalError) instead of ExprError
  t('E10 5,000 nested parentheses -> ExprError', () => throwsExpr(RK, () => E.compile('('.repeat(5000) + '1' + ')'.repeat(5000)), /too deeply nested/));
  t('E10 100,000 unary minus -> ExprError', () => throwsExpr(RK, () => E.compile('-'.repeat(100000) + '1'), /too deeply nested/));
  t('E10 100,000-term sum -> ExprError', () => throwsExpr(RK, () => E.compile(Array(100000).fill('1').join('+')), /too deeply nested/));
  t('E10 50,000 "[" -> ExprError', () => throwsExpr(RK, () => E.compile('['.repeat(50000)), /too deeply nested/));

  // E11 — the "did you mean" suggestion is O(len(name) x len(field)) per field
  t('E11 a 100k-character unknown name fails fast', () => {
    const res = within(500, () => E.compile('x'.repeat(100000), { fields: RK.data.get('peers').fields }));
    assert.ok(res.err instanceof RK.expr.ExprError && /Unknown field/.test(res.err.message), String(res.err));
    assert.ok(res.err.message.length < 300, 'message should not echo 100k characters');
  });

  // E12 — evaluating an aggregate formula on a single record: TypeError "rows.map is not a function"
  t('E12 aggregate formula on one record -> clear ExprError', () => throwsExpr(RK, () => E.compile('sum(v)').eval({ v: 1 }), /aggregate formula .* array of rows/));

  /* ======================= rk.format.js ======================= */

  // F1 — Number.prototype.toFixed rounds the binary value: numbers do not tie to the Excel model
  const xl = [[10.35, '0.0x', '10.4x'], [8.85, '0.0x', '8.9x'], [10.45, '0.0x', '10.5x'], [2.675, '$#,##0.00', '$2.68'], [1.005, '0.00', '1.01'],
    [1.045, '0.00', '1.05'], [1.255, '0.00', '1.26'], [-10.35, '0.0x', '-10.4x'], [-1.005, '#,##0.00;(#,##0.00)', '(1.01)'], [0.01005, '0.00%', '1.01%']];
  for (const [v, code, want] of xl) t('F1 ' + v + ' "' + code + '" -> ' + want + ' (Excel)', () => assert.strictEqual(F(v, code), want));
  t('F1 sample data: Corvane Automation revenue growth 0.0705 -> "7.1%" (renders "7.0%")', () => {
    const row = RK.data.get('peers').rows.find(x => x.company === 'Corvane Automation');
    assert.strictEqual(F(row.rev_growth_25e, RK.data.get('peers').field('rev_growth_25e').format), '7.1%');
  });
  t('F1 sample data: Brightwell Motion EV/LTM revenue 1.65 -> "1.7x" (renders "1.6x")', () => {
    const row = RK.data.get('precedents').rows.find(x => x.target === 'Brightwell Motion');
    assert.strictEqual(F(row.ev_revenue, '0.0x'), '1.7x');
  });
  t('F1 more than 100 decimals does not throw RangeError', () => assert.ok(/^1\.50*$/.test(F(1.5, '0.' + '0'.repeat(150)))));

  // F2 — General (the format of every unformatted column) mis-grouped negatives and rounded small values to 0
  t('F2 General -123456 -> "-123,456" (was "-,123,456")', () => assert.strictEqual(F(-123456), '-123,456'));
  t('F2 General -123456789', () => assert.strictEqual(F(-123456789, 'General'), '-123,456,789'));
  t('F2 General 0.000123 is not "0"', () => assert.strictEqual(F(0.000123), '0.000123'));
  t('F2 General 0.0042 is not "0"', () => assert.strictEqual(F(0.0042), '0.0042'));
  t('F2 General -0.0023 is not "-0"', () => assert.strictEqual(F(-0.0023), '-0.0023'));

  // F3 — toFixed() switches to exponent notation from 1e21 and the code then splits on "."
  t('F3 1e21 "#,##0" (was "1e,+21")', () => assert.strictEqual(F(1e21, '#,##0'), '1,000,000,000,000,000,000,000'));
  t('F3 1.5e300 "#,##0" is not "1.5e+3" (reads as 1,500)', () => { const s = F(1.5e300, '#,##0'); assert.ok(/^1,500,000,000,000,000(,000)+$/.test(s) && s.length > 300, s.slice(0, 40)); });
  t('F3 General 1e21', () => assert.strictEqual(F(1e21), '1,000,000,000,000,000,000,000'));

  // F4 — compact "auto" format
  t('F4 auto 999,950 -> "1m" (was "1000k")', () => assert.strictEqual(F(999950, 'auto'), '1m'));
  t('F4 auto 999.95 -> "1k" (was "1000")', () => assert.strictEqual(F(999.95, 'auto'), '1k'));
  t('F4 auto -0.0001 -> "0" (was "-0")', () => assert.strictEqual(F(-0.0001, 'auto'), '0'));

  // F5 — dates
  t('F5 Invalid Date -> n.a. (was "aN undefined NaN")', () => assert.strictEqual(F(new Date(NaN), 'dd mmm yyyy'), 'n.a.'));
  t('F5 "2026-13-45" is not silently rolled to 14 Feb 2027', () => assert.strictEqual(F('2026-13-45', 'dd mmm yyyy'), '2026-13-45'));
  t('F5 "2026-02-30" is not 02 Mar 2026', () => assert.strictEqual(F('2026-02-30', 'dd mmm yyyy'), '2026-02-30'));
  t('F5 numeric year 2026 with "yyyy" -> "2026" (was "1970")', () => assert.strictEqual(F(2026, 'yyyy'), '2026'));
  t('F5 year(2026) = 2026 in formulas (was 1970)', () => assert.strictEqual(ev('year(fy)', { fy: 2026 }), 2026));
  t('F5 month("2026-13-45") is null', () => assert.strictEqual(ev('month("2026-13-45")'), null));

  // F6 — presets looked up on a plain object
  t('F6 format "constructor" does not throw TypeError', () => assert.strictEqual(F(1, 'constructor'), '1'));
  t('F6 format "toString" / "valueOf" / "__proto__"', () => { for (const c of ['toString', 'valueOf', '__proto__', 'hasOwnProperty']) assert.strictEqual(F(1, c), '1', c); });
  t('F6 decimals("constructor") / isDateCode("valueOf") do not throw', () => { assert.strictEqual(F.decimals('constructor'), null); assert.strictEqual(F.isDateCode('valueOf'), false); });
  t('F6 a mistyped preset ("usd_mn") is not a date code (was "us1_1n")', () => assert.strictEqual(F(4520, 'usd_mn'), '4520'));
  t('F6 a mistyped preset ("eur_mm") is not a date code', () => assert.strictEqual(F(0.5, 'eur_mm'), '0.5'));

  // F7 — an empty zero section hides zeros in Excel ("#,##0;(#,##0);")
  t('F7 empty zero section -> ""', () => assert.strictEqual(F(0, '#,##0;(#,##0);'), ''));

  // F8 — the "no -0.0" rule only applied when there was no negative section
  t('F8 delta_pct -0.0004 -> "0.0%" (was "-0.0%")', () => assert.strictEqual(F(-0.0004, 'delta_pct'), '0.0%'));
  t('F8 delta_pct 0.0004 -> "0.0%" (was "+0.0%")', () => assert.strictEqual(F(0.0004, 'delta_pct'), '0.0%'));
  t('F8 "0.0;(0.0)" -0.04 -> "0.0" (was "(0.0)")', () => assert.strictEqual(F(-0.04, '0.0;(0.0)'), '0.0'));
  t('F8 "0.0;(0.0);\\"–\\"" -0.04 -> "–"', () => assert.strictEqual(F(-0.04, '0.0;(0.0);"–"'), '–'));
  t('F8 literal digits do not defeat the rule ("0.0\\" FY25\\"")', () => assert.strictEqual(F(-0.04, '0.0" FY25"'), '0.0 FY25'));

  // F9 — Excel [$...] tags
  t('F9 [$€-407]#,##0 keeps the euro sign', () => assert.strictEqual(F(1234, '[$€-407]#,##0'), '€1,234'));
  t('F9 [$USD] #,##0', () => assert.strictEqual(F(1234, '[$USD] #,##0'), 'USD 1,234'));
  t('F9 [$-409] locale tag in a date code', () => assert.strictEqual(F('2026-10-14', '[$-409]dd mmm yyyy'), '14 Oct 2026'));

  // F10 — weekday tokens
  t('F10 ddd -> "Wed" (was "1414")', () => assert.strictEqual(F('2026-10-14', 'ddd dd mmm'), 'Wed 14 Oct'));
  t('F10 dddd -> "Wednesday"', () => assert.strictEqual(F('2026-10-14', 'dddd'), 'Wednesday'));

  /* ======================= rk.data.js ======================= */

  // Q1 — "sort by" was read as "sort" + "by" (a group-by clause)
  t('Q1 sort by <column>', () => eqJ(Q('company, ev from peers sort by ev desc top 3').rows.map(x => x.company), ['Sierra Alta Industrial', 'Orbisant Software', 'Kanemori Systems']));
  t('Q1 sort by position asc', () => assert.strictEqual(Q('company, ev from peers sort by 2 asc top 1').rows[0].company, 'Castellari Motion'));

  // Q2 — the clause splitter ignored backslash escapes
  t('Q2 escaped quote inside a where string', () => assert.strictEqual(Q('company from peers where company == "a \\" sort x"').rows.length, 0));
  t('Q2 parse keeps the whole string', () => assert.strictEqual(Q.parse('company where company == "a \\" top 5" from peers').where, 'company == "a \\" top 5"'));

  // Q3 — group by `name with spaces`
  t('Q3 by `HQ city` (backticks were stripped before compiling)', () => assert.strictEqual(Q('count() by `HQ city` from peers').columns[0].name, 'hq_city'));
  t('Q3 spec object with a raw field name containing a blank', () => {
    RK.data.put({ id: 'sp', data: [{ 'Deal type': 'A', v: 1 }, { 'Deal type': 'B', v: 2 }] });
    assert.strictEqual(Q({ select: [{ expr: 'sum(v)' }], by: ['Deal type'], from: 'sp' }).rows.length, 2);
  });

  // Q4 — column formats were inherited from the first argument of any function
  t('Q4 pct_change(...) -> "0.0%" (was "$#,##0": 7% showed as "$0")', () => assert.strictEqual(Q('pct_change(revenue_26e, revenue_25e) from peers top 1').columns[0].format, '0.0%'));
  t('Q4 cagr(...) -> "0.0%"', () => assert.strictEqual(Q('cagr(revenue_26e, revenue_24a, 2) from peers top 1').columns[0].format, '0.0%'));
  t('Q4 year(date) -> "0" (was "dd mmm yyyy": 2019 showed as 01 Jan 1970)', () => assert.strictEqual(Q('year(date) from precedents top 1').columns[0].format, '0'));
  t('Q4 div(ev, ebitda_25e) is not formatted as dollars', () => assert.strictEqual(Q('div(ev, ebitda_25e) from peers top 1').columns[0].format, null));

  // Q5 — top / limit
  t('Q5 top -3 -> ExprError (was: dropped the last 3 rows)', () => throwsExpr(RK, () => Q('company from peers top -3'), /"top" expects a whole number/));
  t('Q5 top 0 -> ExprError (was: all rows)', () => throwsExpr(RK, () => Q('company from peers top 0'), /"top" expects a whole number/));
  t('Q5 top ten -> ExprError (was: all rows)', () => throwsExpr(RK, () => Q('company from peers top ten'), /"top" expects a whole number/));
  t('Q5 limit 2.5 -> ExprError', () => throwsExpr(RK, () => Q('company from peers limit 2.5'), /"limit" expects a whole number/));

  // Q6 — repeated clauses silently replaced each other
  t('Q6 where ... where ... -> ExprError (was: first condition dropped)', () => throwsExpr(RK, () => Q('company from peers where ev > 100000 where ev > 0'), /appears more than once/));
  t('Q6 sort + order by -> ExprError', () => throwsExpr(RK, () => Q('company, ev from peers sort 1 order by 2'), /appears more than once/));

  // Q7 — "format" had to come after "as"
  t('Q7 format before as', () => { const c = Q('sum(ev) format "$#,##0" as "Total EV" from peers').columns[0]; eqJ([c.title, c.format], ['Total EV', '$#,##0']); });

  // Q8 — O(n^2) regex backtracking on long runs of blanks
  const blanks = ' '.repeat(15000);
  t('Q8 sort key followed by 15k blanks parses fast', () => within(200, () => Q.parse('company from peers sort company' + blanks + 'x')));
  t('Q8 select item with 15k blanks parses fast', () => within(200, () => Q.parse('company' + blanks + 'x from peers')));
  t('Q8 format clause with 15k blanks parses fast', () => within(200, () => Q.parse('company' + blanks + 'format' + blanks + '"x" y')));

  // Q9 — computed fields
  t('Q9 redefining a computed field updates its dependents', () => {
    const d = RK.data.put({ id: 'redef', data: [{ ev: 100 }], computed: [{ name: 'a', formula: 'ev * 2' }, { name: 'b', formula: 'a + 1' }] });
    d.addComputed({ name: 'a', formula: 'ev * 10' });
    eqJ([d.rows[0].a, d.rows[0].b], [1000, 1001]);
  });
  t('Q9 self-referencing computed field is rejected (it compounded on every slider move)', () => {
    throwsExpr(RK, () => RK.data.put({ id: 'selfref', data: [{ x: 10 }], computed: [{ name: 'x', formula: 'x * (1 + @g)' }] }), /cannot reference itself/);
  });

  // Q10 — not_in was case-sensitive, in is not
  t('Q10 not_in is case-insensitive', () => {
    try { RK.store.setFilter('nin', { field: 'region', op: 'not_in', values: ['europe'], datasets: ['peers'] }); assert.strictEqual(RK.data.view('peers').length, 12); }
    finally { RK.store.clearFilters(); }
  });

  // Q11 — expr filters compiled without the schema: titles / quoted names were silently not applied
  t('Q11 expr filter with a field title', () => {
    try { RK.store.setFilter('ft', { op: 'expr', expr: '[Enterprise value] > 10000' }); assert.strictEqual(RK.data.view('peers').length, 8); }
    finally { RK.store.clearFilters(); }
  });
  t('Q11 expr filter with a case-variant name', () => {
    try { RK.store.setFilter('fc', { op: 'expr', expr: 'EV_EBITDA_25E > 12' }); assert.strictEqual(RK.data.view('peers').length, 6); }
    finally { RK.store.clearFilters(); }
  });

  // Q12 — RK.data.aggregate built "sum(Market cap)" without quoting
  t('Q12 aggregate() with a field name containing a blank', () => {
    const data = [{ region: 'A', 'Market cap': 5 }, { region: 'A', 'Market cap': 7 }];
    eqJ(RK.data.aggregate(data, { by: ['region'], measures: [{ op: 'sum', field: 'Market cap' }], fields: [{ name: 'region' }, { name: 'Market cap' }] }), [{ region: 'A', 'sum(Market cap)': 12 }]);
  });
  t('Q12 aggregate() {op: "count"} without a field', () => eqJ(RK.data.aggregate([{ a: 1 }, { a: 2 }], { measures: [{ name: 'n', op: 'count' }] }), [{ n: 2 }]));

  // Q13 — rec[name] = v with name "__proto__" swaps the prototype and drops the value
  t('Q13 a field named __proto__ keeps its value in query output', () => {
    RK.data.put({ id: 'pp', schema: { fields: [{ name: '__proto__', type: 'number' }, { name: 'x', type: 'number' }] }, data: JSON.parse('[{"__proto__": 5, "x": 1}]') });
    const row = Q('* from pp').rows[0];
    const d = Object.getOwnPropertyDescriptor(row, '__proto__');
    assert.ok(d && d.value === 5, 'value lost');
    assert.strictEqual(Object.getPrototypeOf(row), Object.getPrototypeOf(RK.util), 'prototype must stay Object.prototype');
  });
  t('Q13 a computed field named __proto__ is stored as data', () => {
    const d = RK.data.put({ id: 'pc', data: [{ x: 1 }], computed: [{ name: '__proto__', formula: 'x + 1' }] });
    const desc = Object.getOwnPropertyDescriptor(d.rows[0], '__proto__');
    assert.ok(desc && desc.value === 2, 'computed value lost');
  });

  // Q14 — query columns built from expressions were always typed 'number'
  t('Q14 a text expression column is typed string', () => assert.strictEqual(Q('company, if(net_debt < 0, "Net cash", "Net debt") as bs from peers').columns[1].type, 'string'));
  t('Q14 min(date) column is typed date', () => assert.strictEqual(Q('min(date) from precedents').columns[0].type, 'date'));

  const res = done({ verbose: process.argv.includes('--list') });
  if (process.argv.includes('--list')) for (const r of res.failed) console.log('fail', r.name);
})().catch(e => { console.error(e); process.exitCode = 1; });
